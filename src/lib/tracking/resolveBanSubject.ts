/**
 * Resolve BanSubject for client-side geofence checks.
 * ShellGeofenceAlerts previously passed name/phone/role (ignored by BanSubject).
 *
 * Masters have useMobileAccess.companyId=null (data scope = all companies).
 * For zone ban matching we still need the membership company on the selected project.
 */
import { supabase } from "@/integrations/supabase/client";
import type { BanSubject } from "@/lib/tracking/restrictedZoneGeom";

export type BanSubjectProfile = {
  phone?: string | null;
  companyId?: string | null;
  /** auth user id — used to resolve project_members.company_id (incl. masters) */
  userId?: string | null;
};

export type ResolvedBanSubject = BanSubject & {
  worker_name?: string | null;
};

function digitsOnly(phone: string | null | undefined): string {
  return (phone || "").replace(/\D/g, "");
}

/** Match active worker row by phone digits within a project. */
export async function lookupWorkerBanFields(
  projectId: string,
  phone: string | null | undefined,
): Promise<{ worker_id: string | null; company_id: string | null; job_type: string | null }> {
  if (!projectId || !phone) {
    return { worker_id: null, company_id: null, job_type: null };
  }
  const digits = digitsOnly(phone);
  if (!digits) return { worker_id: null, company_id: null, job_type: null };

  const { data } = await supabase
    .from("workers")
    .select("id, phone, company_id, job_type")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .limit(80);

  const match = (data || []).find((w) => digitsOnly(w.phone) === digits);
  return {
    worker_id: match?.id || null,
    company_id: match?.company_id || null,
    job_type: match?.job_type || null,
  };
}

/** Membership company for ban checks (works for master accounts too). */
export async function lookupMembershipCompanyId(
  projectId: string,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!projectId || !userId) return null;
  const { data } = await supabase
    .from("project_members")
    .select("company_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { company_id?: string | null } | null)?.company_id || null;
}

/**
 * Build BanSubject for zone access rules.
 * Prefer worker roster company/job → explicit companyId → project_members company.
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
  let companyId = w.company_id || opts.companyId || null;
  if (!companyId) {
    companyId = await lookupMembershipCompanyId(projectId, opts.userId);
  }
  return {
    worker_id: w.worker_id,
    company_id: companyId,
    job_type: w.job_type,
  };
}
