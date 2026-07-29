/**
 * Safety work bundle — join helpers for Assessment ↔ Permit ↔ TBM.
 */
import { supabase } from "@/integrations/supabase/client";

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

const APPROVED_RUN_STATUSES = ["승인완료", "승인", "approved", "APPROVED"] as const;

/** Fetch permit + primary RA + TBM in one round-trip via view. */
export async function fetchSafetyWorkBundle(permitId: string) {
  const { data, error } = await supabase
    .from("v_safety_work_bundle" as any)
    .select("*")
    .eq("work_permit_id", permitId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as SafetyWorkBundle) || null;
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
    .from("work_permit_assessment_links" as any)
    .delete()
    .eq("work_permit_id", permitId);

  if (!ids.length) return;

  const rows = ids.map((assessment_run_id) => ({
    work_permit_id: permitId,
    assessment_run_id,
    is_primary: primaryRunId != null && assessment_run_id === primaryRunId,
  }));
  const { error } = await supabase.from("work_permit_assessment_links" as any).insert(rows);
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
