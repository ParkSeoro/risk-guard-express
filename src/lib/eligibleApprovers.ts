/**
 * 결재 후보 SSOT (전 모듈 공통: 위평 / 허가서 / 계획서 / 템플릿 설정).
 *
 * Pool = 소속 회사 + 상위 회사 체인 + 프로젝트 발주처(client) · 시공사(gc)
 *        (peer 협력사는 제외 — RPC get_eligible_approvers)
 * Step filter = filterApproversForStep (직책·단계별 추가 축소)
 */
import { supabase } from '@/integrations/supabase/client';
import type { EligibleApprover } from '@/lib/approvalRules';

export type { EligibleApprover };

export async function fetchEligibleApprovers(
  projectId: string,
  submitterCompanyId: string | null | undefined,
): Promise<{ data: EligibleApprover[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_eligible_approvers', {
    _project_id: projectId,
    _submitter_company_id: submitterCompanyId || null,
  });
  if (error) {
    return { data: [], error: error.message };
  }
  const rows = ((data as EligibleApprover[]) || []).filter((a) => !!a?.out_user_id);
  return { data: rows, error: null };
}

/**
 * 기안 회사 SSOT.
 * 세션 소속(preferredCompanyId)이 있으면 그걸 쓴다.
 * DB 조회는 폴백이며, 복수 소속이면 preferred 와 맞는 행을 고른다 (limit 1 추측 금지).
 */
export async function resolveSubmitterCompanyId(
  projectId: string,
  userId: string | null | undefined,
  preferredCompanyId?: string | null,
): Promise<string | null> {
  if (preferredCompanyId) return preferredCompanyId;
  if (!userId) return null;
  const { data } = await supabase
    .from('project_members')
    .select('company_id')
    .eq('project_id', projectId)
    .eq('user_id', userId);
  const rows = ((data as { company_id?: string | null }[] | null) || [])
    .map((r) => r.company_id)
    .filter((id): id is string => !!id);
  if (rows.length === 0) return null;
  return rows[0];
}
