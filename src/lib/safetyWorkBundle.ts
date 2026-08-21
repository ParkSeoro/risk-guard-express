/**
 * Safety work bundle — join helpers for Assessment ↔ Permit ↔ TBM.
 */
import { supabase } from "@/integrations/supabase/client";
import { filterRunsByCompanyScope } from "@/lib/companyDocScope";

export type SafetyWorkBundle = {
  work_permit_id: string;
  project_id: string;
  permit_status: string | null;
  permit_date: string | null;
  work_name: string | null;
  primary_assessment_run_id: string | null;
  assessment_period_label: string | null;
  assessment_status: string | null;
  tbm_session_id: string | null;
  tbm_title: string | null;
  tbm_session_date: string | null;
  work_plan_id: string | null;
  work_plan_title: string | null;
};

export type LinkedAssessmentRun = {
  id: string;
  period_label: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  target_company_ids?: string[] | null;
};

const APPROVED_RUN_STATUSES = ["승인완료", "승인", "approved", "APPROVED"] as const;

/** Fetch permit + primary RA + TBM in one round-trip via view. */
export async function fetchSafetyWorkBundle(permitId: string) {
  const { data, error } = await supabase
    .from("v_safety_work_bundle")
    .select("*")
    .eq("work_permit_id", permitId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Sync junction rows from scalar + array fields (keeps uuid[] and FK table aligned). */
export async function syncPermitAssessmentLinks(
  permitId: string,
  primaryRunId: string | null,
  linkedRunIds: string[] = [],
) {
  const ids = Array.from(
    new Set(
      [...linkedRunIds, ...(primaryRunId ? [primaryRunId] : [])].filter(Boolean) as string[],
    ),
  );
  await supabase
    .from("work_permit_assessment_links")
    .delete()
    .eq("work_permit_id", permitId);

  if (!ids.length) return;

  const rows = ids.map((assessment_run_id) => ({
    work_permit_id: permitId,
    assessment_run_id,
    is_primary: primaryRunId != null && assessment_run_id === primaryRunId,
  }));
  const { error } = await supabase.from("work_permit_assessment_links").insert(rows);
  if (error) throw error;
}

/** Approved assessment runs available to link when creating permits / TBM. */
export async function fetchApprovedAssessmentRuns(projectId: string) {
  const { data, error } = await supabase
    .from("assessment_runs")
    .select("id, period_label, status, start_date, end_date")
    .eq("project_id", projectId)
    .eq("is_deleted", false)
    .in("status", [...APPROVED_RUN_STATUSES])
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export function isApprovedAssessmentStatus(status?: string | null) {
  return !!status && (APPROVED_RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * Document snapshot of RAs linked to a permit (junction → array → primary FK).
 * Never rediscovers by viewer permissions.
 */
export async function fetchPermitLinkedAssessments(permit: {
  id: string;
  assessment_run_id?: string | null;
  linked_assessment_run_ids?: string[] | null;
}): Promise<LinkedAssessmentRun[]> {
  const { data: links, error: linkErr } = await supabase
    .from("work_permit_assessment_links")
    .select("assessment_run_id, is_primary")
    .eq("work_permit_id", permit.id);
  if (linkErr) throw linkErr;

  let ids: string[] = [];
  if (links && links.length > 0) {
    const primary = links.find((l) => l.is_primary)?.assessment_run_id;
    const rest = links.map((l) => l.assessment_run_id).filter((id) => id && id !== primary);
    ids = [...(primary ? [primary] : []), ...rest].filter(Boolean) as string[];
  } else {
    const soft = Array.isArray(permit.linked_assessment_run_ids)
      ? permit.linked_assessment_run_ids.filter(Boolean)
      : [];
    if (permit.assessment_run_id) soft.unshift(permit.assessment_run_id);
    ids = Array.from(new Set(soft.map(String)));
  }

  if (!ids.length) return [];

  const { data: runs, error } = await supabase
    .from("assessment_runs")
    .select("id, period_label, status, start_date, end_date, target_company_ids")
    .in("id", ids);
  if (error) throw error;

  const byId = new Map((runs || []).map((r) => [r.id, r as LinkedAssessmentRun]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as LinkedAssessmentRun[];
}

/**
 * Draft-only candidate discovery: date-valid approved runs scoped to permit company tree.
 */
export async function discoverPermitDateValidRuns(opts: {
  projectId: string;
  permitDate: string;
  /** Prefer permit.company_id — scopes candidates to that company's RA targets. */
  companyId?: string | null;
  accessibleCompanyIds?: string[] | null;
  userId?: string | null;
}): Promise<LinkedAssessmentRun[]> {
  const { data, error } = await supabase
    .from("assessment_runs")
    .select("id, period_label, status, start_date, end_date, target_company_ids, created_by")
    .eq("project_id", opts.projectId)
    .eq("is_deleted", false)
    .eq("status", "승인완료")
    .lte("start_date", opts.permitDate)
    .gte("end_date", opts.permitDate);
  if (error) throw error;

  let rows = (data || []) as LinkedAssessmentRun[];
  const scopeIds =
    opts.accessibleCompanyIds !== undefined
      ? opts.accessibleCompanyIds
      : opts.companyId
        ? [opts.companyId]
        : null;
  if (scopeIds !== null) {
    rows = filterRunsByCompanyScope(rows as any, {
      userId: opts.userId,
      accessibleCompanyIds: scopeIds,
    }) as LinkedAssessmentRun[];
  }
  return rows;
}
