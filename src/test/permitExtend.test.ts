import { describe, expect, it } from 'vitest';
import {
  isPermitExtendPostStep,
  mapPermitExtendRequestError,
  permitExtendReasonFromForm,
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

describe('mapPermitExtendRequestError', () => {
  it('maps CM/reason codes', () => {
    expect(mapPermitExtendRequestError('NO_CM')).toBe('발주처 CM을 찾을 수 없습니다.');
    expect(mapPermitExtendRequestError('REASON_REQUIRED')).toBe('연장 사유를 입력하세요.');
    expect(mapPermitExtendRequestError('NO_SM')).toBe('발주처 SM을 찾을 수 없습니다.');
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
