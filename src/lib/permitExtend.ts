/** 허가서 연장 신청·결재 공유 헬퍼. 양식/인쇄에는 사유를 넣지 않는다. */
import { supabase } from '@/integrations/supabase/client';
import { permitPostStepKind } from '@/lib/permitPostApproval';

/** 전회차 복사 때 이전 결재·연장 신청이 새 허가서로 따라오지 않게 뺀다. */
const PERMIT_CLONE_OMIT_KEYS = [
  'approved_at',
  'reviewed_at',
  'work_extend_until',
  'work_extend_requested_until',
  'work_extend_requested_at',
  'work_extend_requested_by',
  'work_extend_requested_reason',
  'work_extend_reason',
  'work_void_requested_reason',
  'work_void_requested_at',
  'work_void_requested_by',
  'work_void_requested_by_name',
] as const;

export function permitFormDataForClone(
  formData?: Record<string, unknown> | null,
): Record<string, unknown> {
  const next = { ...(formData || {}) };
  for (const key of PERMIT_CLONE_OMIT_KEYS) delete next[key];
  return next;
}

export function permitExtendReasonFromForm(formData?: Record<string, unknown> | null): string {
  const d = formData || {};
  return String(d.work_extend_requested_reason || d.work_extend_reason || '').trim();
}

export function isPermitExtendPostStep(position?: string | null): boolean {
  const k = permitPostStepKind(position);
  return k === 'extend_cm' || k === 'extend_sm';
}

export function permitVoidRequestReasonFromForm(formData?: Record<string, unknown> | null): string {
  return String((formData || {}).work_void_requested_reason || '').trim();
}

export async function loadPermitExtendReasons(
  rows: Array<{ entity_id?: string | null; step_position?: string | null; position?: string | null }>,
): Promise<Record<string, string>> {
  const voidIds = new Set(
    rows
      .filter((r) => permitPostStepKind(r.step_position || r.position) === 'void_request_client')
      .map((r) => r.entity_id)
      .filter((id): id is string => !!id),
  );
  const ids = Array.from(new Set([
    ...rows
      .filter((r) => isPermitExtendPostStep(r.step_position || r.position))
      .map((r) => r.entity_id)
      .filter((id): id is string => !!id),
    ...voidIds,
  ]));
  if (ids.length === 0) return {};
  const { data } = await supabase.from('work_permits' as any).select('id, form_data').in('id', ids);
  const out: Record<string, string> = {};
  for (const p of (data as { id: string; form_data?: Record<string, unknown> }[] | null) || []) {
    const reason = voidIds.has(p.id)
      ? permitVoidRequestReasonFromForm(p.form_data)
      : permitExtendReasonFromForm(p.form_data);
    if (reason) out[p.id] = reason;
  }
  return out;
}

export function mapPermitExtendRequestError(code: string): string {
  if (code === 'MUST_BE_AFTER_CURRENT_END') return '현재 종료 시각보다 이후여야 합니다.';
  if (code === 'MUST_BE_FUTURE') return '현재 시각보다 이후여야 합니다.';
  if (code === 'PENDING_POST_APPROVAL') return '이미 종료/연장 결재가 진행 중입니다.';
  if (code === 'NO_SM') return '발주처 SM을 찾을 수 없습니다.';
  if (code === 'NO_CM') return '발주처 CM을 찾을 수 없습니다.';
  if (code === 'REASON_REQUIRED') return '연장 사유를 입력하세요.';
  if (code === 'NOT_APPROVED') return '승인된 허가서만 연장할 수 있습니다.';
  if (code === 'FORBIDDEN') return '권한이 없습니다.';
  if (code === 'NO_PENDING_EXTENSION') return '취소할 연장 신청이 없습니다.';
  if (code === 'NOT_REQUESTER') return '연장 신청자만 취소할 수 있습니다.';
  if (code === 'UNAUTHENTICATED') return '로그인이 필요합니다.';
  return code;
}

/** 연장 신청 대기 중이고 현재 사용자가 신청자일 때만 철회 가능. */
export function canCancelPermitExtension(
  formData?: Record<string, unknown> | null,
  userId?: string | null,
): boolean {
  if (!userId) return false;
  const d = formData || {};
  if (!d.work_extend_requested_until) return false;
  return String(d.work_extend_requested_by || '') === userId;
}
