import { describe, expect, it } from 'vitest';
import {
  contactPhonesFromApprovals,
  mergeApprovalSignatures,
  resolveSigKey,
  resolveSpecialFormSigSlot,
  slotSignedAt,
} from '@/lib/permitApprovalSignatures';
import type { PermitSignatures } from '@/components/permits/DigPermitForm';

describe('resolveSigKey', () => {
  it('maps Korean labels and position keys to slots', () => {
    expect(resolveSigKey('담당자(시공)', null)).toBe('contractor_pic');
    expect(resolveSigKey(null, 'owner_cm')).toBe('cm');
    expect(resolveSigKey(null, 'owner_sm')).toBe('sm');
    expect(resolveSigKey(null, 'contractor_safety_manager')).toBe('safety_pic');
    expect(resolveSigKey(null, 'gc_manager')).toBe('gc_manager');
    expect(resolveSigKey('시공사 관리자', null)).toBe('gc_manager');
    expect(resolveSigKey(null, 'closure_sm')).toBe('closure_approver');
    expect(resolveSigKey('closure_approver', null)).toBe('closure_approver');
  });
});

describe('mergeApprovalSignatures — independent timestamps', () => {
  const t1 = '2026-07-28T09:00:00.000Z';
  const t2 = '2026-07-28T10:15:00.000Z';
  const t3 = '2026-07-28T11:30:00.000Z';
  const t4 = '2026-07-28T14:00:00.000Z';
  const t5 = '2026-07-28T15:45:00.000Z';

  it('binds each approver row approved_at to its own slot.signed_at', () => {
    const merged = mergeApprovalSignatures({}, [
      { position: 'contractor_supervisor', approver_name: '시공', status: '승인', approved_at: t1 },
      { position: 'contractor_safety_manager', approver_name: '안전', status: '승인', approved_at: t2 },
      { position: 'contractor_site_director', approver_name: '소장', status: '승인', approved_at: t3 },
      { position: 'owner_cm', approver_name: 'CM', status: '승인', approved_at: t4 },
      { position: 'owner_sm', approver_name: 'SM', status: '승인', approved_at: t5 },
    ]);

    expect(merged.contractor_pic?.signed_at).toBe(t1);
    expect(merged.safety_pic?.signed_at).toBe(t2);
    expect(merged.site_director?.signed_at).toBe(t3);
    expect(merged.cm?.signed_at).toBe(t4);
    expect(merged.sm?.signed_at).toBe(t5);

    // Must not collapse to a single shared clock
    const stamps = [
      merged.contractor_pic?.signed_at,
      merged.safety_pic?.signed_at,
      merged.site_director?.signed_at,
      merged.cm?.signed_at,
      merged.sm?.signed_at,
    ];
    expect(new Set(stamps).size).toBe(5);

    // Legacy mirrors only (not for stamp cells)
    expect(merged.reviewed_at).toBe(t4);
    expect(merged.approved_at).toBe(t5);
  });

  it('overwrites stale identical baseSig signed_at with per-row approved_at', () => {
    const stale = '2026-07-28T16:00:00.000Z';
    const base: PermitSignatures = {
      contractor_pic: { name: '시공', signature: 'data:img', signed_at: stale },
      safety_pic: { name: '안전', signature: '', signed_at: stale },
      cm: { name: 'CM', signature: '', signed_at: stale },
      sm: { name: 'SM', signature: '', signed_at: stale },
      approved_at: stale,
      reviewed_at: stale,
    };
    const merged = mergeApprovalSignatures(base, [
      { position: 'contractor_supervisor', approver_name: '시공', status: '승인', approved_at: t1 },
      { position: 'contractor_safety_manager', approver_name: '안전', status: '승인', approved_at: t2 },
      { position: 'owner_cm', approver_name: 'CM', status: '승인', approved_at: t4 },
      { position: 'owner_sm', approver_name: 'SM', status: '승인', approved_at: t5 },
    ]);
    expect(merged.contractor_pic?.signed_at).toBe(t1);
    expect(merged.contractor_pic?.signature).toBe('data:img'); // keep pad image
    expect(merged.safety_pic?.signed_at).toBe(t2);
    expect(merged.cm?.signed_at).toBe(t4);
    expect(merged.sm?.signed_at).toBe(t5);
  });

  it('slotSignedAt never reads document-level approved_at', () => {
    const sig: PermitSignatures = {
      approved_at: '2026-07-28T23:00:00.000Z',
      reviewed_at: '2026-07-28T22:00:00.000Z',
      cm: { name: 'CM', signature: '', signed_at: '2026-07-28T14:00:00.000Z' },
    };
    expect(slotSignedAt(sig, 'cm')).toBe('2026-07-28T14:00:00.000Z');
    expect(slotSignedAt(sig, 'sm')).toBeUndefined();
  });

  it('maps closure_sm approval into closure_approver (not sm)', () => {
    const closedAt = '2026-08-03T18:00:00.000Z';
    const merged = mergeApprovalSignatures(
      { sm: { name: '발급SM', signature: '', signed_at: t5 }, approved_at: t5 },
      [{ position: 'closure_sm', approver_name: '종료SM', status: '승인', approved_at: closedAt }],
    );
    expect(merged.closure_approver?.name).toBe('종료SM');
    expect(merged.closure_approver?.signed_at).toBe(closedAt);
    expect(merged.closed_at).toBe(closedAt);
    // Issuance SM stamp must remain independent
    expect(merged.sm?.name).toBe('발급SM');
    expect(merged.sm?.signed_at).toBe(t5);
  });

  it('mirrors contractor_pic into applicant for special-form 신청인 cells', () => {
    const merged = mergeApprovalSignatures({}, [
      {
        position: 'contractor_supervisor',
        approver_name: '김신청',
        status: '승인',
        approved_at: t1,
      },
    ]);
    expect(merged.contractor_pic?.name).toBe('김신청');
    expect(merged.contractor_pic?.signed_at).toBe(t1);
    expect(merged.applicant?.name).toBe('김신청');
    expect(merged.applicant?.signed_at).toBe(t1);
  });
});

describe('resolveSpecialFormSigSlot — issuance vs paper keys', () => {
  const t1 = '2026-07-28T09:00:00.000Z';
  const t2 = '2026-07-28T10:15:00.000Z';
  const t3 = '2026-07-28T11:30:00.000Z';
  const t4 = '2026-07-28T14:00:00.000Z';
  const t5 = '2026-07-28T15:45:00.000Z';

  it('fills 관리감독자 from contractor_pic and 승인자 from sm after issuance', () => {
    const merged = mergeApprovalSignatures({}, [
      { position: 'contractor_supervisor', approver_name: '차강찬', status: '승인', approved_at: t1 },
      { position: 'contractor_safety_manager', approver_name: '박상우', status: '승인', approved_at: t2 },
      { position: 'owner_sm', approver_name: '최종SM', status: '승인', approved_at: t5 },
    ]);
    expect(resolveSpecialFormSigSlot(merged, 'site_supervisor')?.name).toBe('차강찬');
    expect(resolveSpecialFormSigSlot(merged, 'safety_pic')?.name).toBe('박상우');
    expect(resolveSpecialFormSigSlot(merged, 'closure_approver')?.name).toBe('최종SM');
    expect(resolveSpecialFormSigSlot(merged, 'applicant')?.name).toBe('차강찬');
  });

  it('keeps 관리감독자 as issuance; prefers closure SM for 승인자 when present', () => {
    const merged = mergeApprovalSignatures({}, [
      { position: 'contractor_supervisor', approver_name: '상신자', status: '승인', approved_at: t1 },
      { position: 'owner_sm', approver_name: '발급SM', status: '승인', approved_at: t5 },
      { position: 'closure_supervisor', approver_name: '종료감독', status: '승인', approved_at: t3 },
      { position: 'closure_sm', approver_name: '종료SM', status: '승인', approved_at: t4 },
    ]);
    expect(resolveSpecialFormSigSlot(merged, 'site_supervisor')?.name).toBe('상신자');
    expect(resolveSpecialFormSigSlot(merged, 'closure_approver')?.name).toBe('종료SM');
  });
});

describe('contactPhonesFromApprovals', () => {
  it('maps safety/supervisor phones from approved rows', () => {
    const phones = contactPhonesFromApprovals(
      [
        { position: 'contractor_supervisor', status: '승인', approver_id: 'u1' },
        { position: 'contractor_safety_manager', status: '승인', approver_id: 'u2' },
        { position: 'owner_sm', status: '승인', approver_id: 'u3' },
      ],
      { u1: '010-1111-1111', u2: '010-2222-2222', u3: '010-3333-3333' },
    );
    expect(phones.supervisor_phone).toBe('010-1111-1111');
    expect(phones.safety_manager_phone).toBe('010-2222-2222');
  });
});
