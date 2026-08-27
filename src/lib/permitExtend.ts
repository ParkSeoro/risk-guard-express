/** 허가서 연장 신청·결재 공유 헬퍼. 양식/인쇄에는 사유를 넣지 않는다. */
import { supabase } from '@/integrations/supabase/client';
import { permitPostStepKind } from '@/lib/permitPostApproval';

export function permitExtendReasonFromForm(formData?: Record<string, unknown> | null): string {
  const d = formData || {};
  return String(d.work_extend_requested_reason || d.work_extend_reason || '').trim();
}

export function isPermitExtendPostStep(position?: string | null): boolean {
  const k = permitPostStepKind(position);
  return k === 'extend_cm' || k === 'extend_sm';
}

export async function loadPermitExtendReasons(
  rows: Array<{ entity_id?: string | null; step_position?: string | null; position?: string | null }>,
): Promise<Record<string, string>> {
  const ids = Array.from(new Set(
    rows
      .filter((r) => isPermitExtendPostStep(r.step_position || r.position))
      .map((r) => r.entity_id)
      .filter((id): id is string => !!id),
  ));
  if (ids.length === 0) return {};
  const { data } = await supabase.from('work_permits' as any).select('id, form_data').in('id', ids);
  const out: Record<string, string> = {};
  for (const p of (data as { id: string; form_data?: Record<string, unknown> }[] | null) || []) {
    const reason = permitExtendReasonFromForm(p.form_data);
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
  return code;
}
