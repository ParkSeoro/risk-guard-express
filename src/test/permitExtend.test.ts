import { describe, expect, it } from 'vitest';
import {
  canCancelPermitExtension,
  isPermitExtendPostStep,
  mapPermitExtendRequestError,
  permitExtendReasonFromForm,
  permitFormDataForClone,
} from '@/lib/permitExtend';
import { permitPostStepBadge, permitPostStepKind } from '@/lib/permitPostApproval';
import { mergeApprovalSignatures, POSITION_TO_SIG, resolveSigKey } from '@/lib/permitApprovalSignatures';

describe('permitExtendReasonFromForm', () => {
  it('prefers pending requested reason over persisted reason', () => {
    expect(permitExtendReasonFromForm({
      work_extend_requested_reason: ' 야간 타설 ',
      work_extend_reason: '이전 사유',
    })).toBe('야간 타설');
  });

  it('falls back to persisted reason after SM approve', () => {
    expect(permitExtendReasonFromForm({ work_extend_reason: '우천 지연' })).toBe('우천 지연');
  });

  it('returns empty when neither is set', () => {
    expect(permitExtendReasonFromForm({})).toBe('');
    expect(permitExtendReasonFromForm(null)).toBe('');
  });
});

describe('permitFormDataForClone', () => {
  it('keeps the work content and drops the previous extension request', () => {
    const cloned = permitFormDataForClone({
      work_name: '3P N2 Tank 설치공사',
      work_start: '2026-10-21T08:00',
      work_end: '2026-10-21T17:00',
      approved_at: '2026-10-20T07:51:29Z',
      reviewed_at: '2026-10-20T05:32:04Z',
      work_extend_until: '2026-10-20T18:30',
      work_extend_requested_until: '2026-10-20T09:30:00+00:00',
      work_extend_requested_at: '2026-10-20T04:31:05+00:00',
      work_extend_requested_by: 'user-1',
      work_extend_requested_reason: '내조 용접',
      work_extend_reason: '이전 사유',
    });

    expect(cloned.work_name).toBe('3P N2 Tank 설치공사');
    expect(cloned.work_start).toBe('2026-10-21T08:00');
    expect(cloned.work_end).toBe('2026-10-21T17:00');
    expect(cloned).not.toHaveProperty('approved_at');
    expect(cloned).not.toHaveProperty('reviewed_at');
    expect(cloned).not.toHaveProperty('work_extend_until');
    expect(cloned).not.toHaveProperty('work_extend_requested_until');
    expect(cloned).not.toHaveProperty('work_extend_requested_at');
    expect(cloned).not.toHaveProperty('work_extend_requested_by');
    expect(cloned).not.toHaveProperty('work_extend_requested_reason');
    expect(cloned).not.toHaveProperty('work_extend_reason');
  });
});

describe('mapPermitExtendRequestError', () => {
  it('maps CM/reason codes', () => {
    expect(mapPermitExtendRequestError('NO_CM')).toBe('발주처 CM을 찾을 수 없습니다.');
    expect(mapPermitExtendRequestError('REASON_REQUIRED')).toBe('연장 사유를 입력하세요.');
    expect(mapPermitExtendRequestError('NO_SM')).toBe('발주처 SM을 찾을 수 없습니다.');
  });

  it('maps cancel codes', () => {
    expect(mapPermitExtendRequestError('NO_PENDING_EXTENSION')).toBe('취소할 연장 신청이 없습니다.');
    expect(mapPermitExtendRequestError('NOT_REQUESTER')).toBe('연장 신청자만 취소할 수 있습니다.');
  });
});

describe('canCancelPermitExtension', () => {
  it('allows only the requester while a request is pending', () => {
    expect(canCancelPermitExtension({
      work_extend_requested_until: '2026-10-14T20:00',
      work_extend_requested_by: 'user-1',
    }, 'user-1')).toBe(true);
    expect(canCancelPermitExtension({
      work_extend_requested_until: '2026-10-14T20:00',
      work_extend_requested_by: 'user-1',
    }, 'user-2')).toBe(false);
    expect(canCancelPermitExtension({ work_extend_requested_by: 'user-1' }, 'user-1')).toBe(false);
    expect(canCancelPermitExtension(null, 'user-1')).toBe(false);
  });
});

describe('extend_cm is post-approval without a print stamp', () => {
  it('labels CM vs SM steps', () => {
    expect(permitPostStepKind('extend_cm')).toBe('extend_cm');
    expect(permitPostStepKind('extend_sm')).toBe('extend_sm');
    expect(permitPostStepBadge('extend_cm')).toBe('발주처 CM 연장 검토');
    expect(permitPostStepBadge('extend_sm')).toBe('작업허가 연장 승인');
    expect(isPermitExtendPostStep('extend_cm')).toBe(true);
    expect(isPermitExtendPostStep('extend_sm')).toBe(true);
    expect(isPermitExtendPostStep('owner_cm')).toBe(false);
  });

  it('does not map extend_cm onto any signature slot', () => {
    expect(POSITION_TO_SIG.extend_cm).toBeUndefined();
    expect(resolveSigKey(null, 'extend_cm')).toBeNull();
    expect(resolveSigKey(null, 'extend_sm')).toBe('extension_approver');
  });

  it('stamps only SM onto 작업허가 연장 승인', () => {
    const tCm = '2026-08-27T10:00:00.000Z';
    const tSm = '2026-08-27T11:00:00.000Z';
    const merged = mergeApprovalSignatures({}, [
      { position: 'extend_cm', approver_name: '발주처CM', status: '승인', approved_at: tCm },
      { position: 'extend_sm', approver_name: '발주처SM', status: '승인', approved_at: tSm },
    ]);
    expect(merged.extension_approver?.name).toBe('발주처SM');
    expect(merged.extension_approver?.signed_at).toBe(tSm);
    expect(merged.cm?.name).toBeFalsy();
  });
});
