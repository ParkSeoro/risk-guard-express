/**
 * Deno-friendly copy — keep in sync with src/lib/tracking/accessRules.ts
 */

export type ZoneRuleType = "ALLOW" | "DENY";

export type AccessRules = {
  rule_type: ZoneRuleType;
  company_ids: string[];
  job_types: string[];
};

export type AccessSubject = {
  worker_id?: string | null;
  company_id?: string | null;
  job_type?: string | null;
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String).map((s) => s.trim()).filter(Boolean);
}

export function parseAccessRules(raw: unknown): AccessRules {
  if (!raw || typeof raw !== "object") {
    return { rule_type: "DENY", company_ids: [], job_types: [] };
  }
  const o = raw as Record<string, unknown>;
  if (o.rule_type === "ALLOW" || o.rule_type === "DENY") {
    return {
      rule_type: o.rule_type,
      company_ids: asStringArray(o.company_ids),
      job_types: asStringArray(o.job_types),
    };
  }
  if (o.mode === "allow_companies") {
    return { rule_type: "ALLOW", company_ids: asStringArray(o.company_ids), job_types: [] };
  }
  if (o.mode === "allow_job_types") {
    return { rule_type: "ALLOW", company_ids: [], job_types: asStringArray(o.job_types) };
  }
  return { rule_type: "DENY", company_ids: [], job_types: [] };
}

function subjectMatchesTargets(rules: AccessRules, subject: AccessSubject): boolean {
  const companies = rules.company_ids || [];
  const jobs = (rules.job_types || []).map((j) => j.toLowerCase());
  const companyHit = !!(subject.company_id && companies.includes(subject.company_id));
  const jobHit = !!(
    subject.job_type &&
    jobs.includes(subject.job_type.trim().toLowerCase())
  );
  return companyHit || jobHit;
}

export function isAccessForbidden(
  rulesInput: unknown,
  subject: AccessSubject,
  legacy?: {
    banned_worker_ids?: string[] | null;
    banned_company_ids?: string[] | null;
    banned_job_types?: string[] | null;
    rule_type?: string | null;
  },
): boolean {
  const rules = parseAccessRules(rulesInput);
  if (legacy?.rule_type === "ALLOW" || legacy?.rule_type === "DENY") {
    rules.rule_type = legacy.rule_type;
  }

  const hasTargets =
    (rules.company_ids?.length || 0) > 0 || (rules.job_types?.length || 0) > 0;

  if (rules.rule_type === "ALLOW") {
    if (!hasTargets) return true;
    return !subjectMatchesTargets(rules, subject);
  }

  if (!hasTargets) {
    const workers = legacy?.banned_worker_ids || [];
    const companies = legacy?.banned_company_ids || [];
    const jobs = (legacy?.banned_job_types || []).map((j) => j.trim().toLowerCase()).filter(Boolean);
    if (workers.length === 0 && companies.length === 0 && jobs.length === 0) return true;
    if (subject.worker_id && workers.includes(subject.worker_id)) return true;
    if (subject.company_id && companies.includes(subject.company_id)) return true;
    if (subject.job_type && jobs.includes(subject.job_type.trim().toLowerCase())) return true;
    return false;
  }

  return subjectMatchesTargets(rules, subject);
}
