/**
 * Resolve BanSubject for client-side geofence checks.
 * ShellGeofenceAlerts previously passed name/phone/role (ignored by BanSubject).
 */
import { supabase } from "@/integrations/supabase/client";
import type { BanSubject } from "@/lib/tracking/restrictedZoneGeom";

export type BanSubjectProfile = {
  phone?: string | null;
  companyId?: string | null;
};

export type ResolvedBanSubject = BanSubject & {
  worker_name?: string | null;
};

/** Match active worker row by phone digits within a project. */
export async function lookupWorkerBanFields(
  projectId: string,
  phone: string | null | undefined,
): Promise<{ worker_id: string | null; company_id: string | null; job_type: string | null }> {
  if (!projectId || !phone) {
    return { worker_id: null, company_id: null, job_type: null };
  }
  const digits = phone.replace(/\D/g, "");
  if (!digits) return { worker_id: null, company_id: null, job_type: null };

  const { data } = await supabase
    .from("workers")
    .select("id, phone, company_id, job_type")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .limit(80);

  const match = (data || []).find((w) => (w.phone || "").replace(/\D/g, "") === digits);
  return {
    worker_id: match?.id || null,
    company_id: match?.company_id || null,
    job_type: match?.job_type || null,
  };
}

/**
 * Build BanSubject for zone access rules.
 * Prefer worker roster company/job; fall back to project_members companyId.
 */
export async function resolveBanSubject(
  projectId: string | null | undefined,
  opts: BanSubjectProfile,
): Promise<BanSubject> {
  if (!projectId) {
    return {
      worker_id: null,
      company_id: opts.companyId || null,
      job_type: null,
    };
  }
  const w = await lookupWorkerBanFields(projectId, opts.phone);
  return {
    worker_id: w.worker_id,
    company_id: w.company_id || opts.companyId || null,
    job_type: w.job_type,
  };
}
