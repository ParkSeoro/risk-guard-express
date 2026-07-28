/**
 * Deno-friendly copy of access rule evaluation for track-location Edge Function.
 * Keep in sync with src/lib/tracking/accessRules.ts
 */

export type AccessRules = {
  mode: "deny_all" | "allow_companies" | "allow_job_types";
  company_ids?: string[];
  job_types?: string[];
};

export type AccessSubject = {
  worker_id?: string | null;
  company_id?: string | null;
  job_type?: string | null;
};

export function parseAccessRules(raw: unknown): AccessRules {
  if (!raw || typeof raw !== "object") return { mode: "deny_all" };
  const o = raw as Record<string, unknown>;
  if (o.mode === "allow_companies") {
    return {
      mode: "allow_companies",
      company_ids: Array.isArray(o.company_ids) ? o.company_ids.map(String).filter(Boolean) : [],
    };
  }
  if (o.mode === "allow_job_types") {
    return {
      mode: "allow_job_types",
      job_types: Array.isArray(o.job_types)
        ? o.job_types.map(String).map((s) => s.trim()).filter(Boolean)
        : [],
    };
  }
  return { mode: "deny_all" };
}

export function isAccessForbidden(
  rulesInput: unknown,
  subject: AccessSubject,
  legacy?: {
    banned_worker_ids?: string[] | null;
    banned_company_ids?: string[] | null;
    banned_job_types?: string[] | null;
  },
): boolean {
  const rules = parseAccessRules(rulesInput);

  if (rules.mode === "deny_all") return true;

  if (rules.mode === "allow_companies") {
    const allowed = rules.company_ids || [];
    if (allowed.length === 0) return true;
    if (!subject.company_id) return true;
    return !allowed.includes(subject.company_id);
  }

  if (rules.mode === "allow_job_types") {
    const allowed = (rules.job_types || []).map((j) => j.trim().toLowerCase()).filter(Boolean);
    if (allowed.length === 0) return true;
    if (!subject.job_type) return true;
    return !allowed.includes(subject.job_type.trim().toLowerCase());
  }

  const workers = legacy?.banned_worker_ids || [];
  const companies = legacy?.banned_company_ids || [];
  const jobs = (legacy?.banned_job_types || []).map((j) => j.trim().toLowerCase()).filter(Boolean);
  if (workers.length === 0 && companies.length === 0 && jobs.length === 0) return true;
  if (subject.worker_id && workers.includes(subject.worker_id)) return true;
  if (subject.company_id && companies.includes(subject.company_id)) return true;
  if (subject.job_type && jobs.includes(subject.job_type.trim().toLowerCase())) return true;
  return false;
}
