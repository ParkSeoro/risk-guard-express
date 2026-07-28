/**
 * Restricted-zone access control rules (JSONB on restricted_zones.access_rules).
 *
 * JSON shape:
 * {
 *   "mode": "deny_all" | "allow_companies" | "allow_job_types",
 *   "company_ids": ["uuid", ...],   // when mode=allow_companies
 *   "job_types": ["용접공", ...]    // when mode=allow_job_types
 * }
 *
 * Semantics (alarm / unauthorized when true = forbidden):
 * - deny_all: 전면 통제 — anyone entering triggers alarm
 * - allow_companies: only listed companies may enter; others forbidden
 * - allow_job_types: only listed job types may enter; others forbidden
 */

export type AccessRuleMode = "deny_all" | "allow_companies" | "allow_job_types";

export type AccessRules = {
  mode: AccessRuleMode;
  company_ids?: string[];
  job_types?: string[];
};

export type AccessSubject = {
  worker_id?: string | null;
  company_id?: string | null;
  job_type?: string | null;
};

export const ZONE_CATEGORY_OPTIONS = [
  { value: "추락위험", label: "추락위험" },
  { value: "화재위험", label: "화재위험" },
  { value: "밀폐공간", label: "밀폐공간" },
  { value: "중장비반입", label: "중장비반입" },
  { value: "감전위험", label: "감전위험" },
  { value: "기타", label: "기타" },
] as const;

export const JOB_TYPE_OPTIONS = [
  "용접공",
  "배관공",
  "전기공",
  "비계공",
  "철골공",
  "콘크리트공",
  "굴착기운전",
  "크레인운전",
  "신호수",
  "관리감독자",
  "안전관리자",
  "일반근로자",
] as const;

export const DEFAULT_ACCESS_RULES: AccessRules = { mode: "deny_all" };

export function parseAccessRules(raw: unknown): AccessRules {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ACCESS_RULES };
  const o = raw as Record<string, unknown>;
  const mode = o.mode;
  if (mode === "allow_companies") {
    return {
      mode: "allow_companies",
      company_ids: Array.isArray(o.company_ids)
        ? o.company_ids.map(String).filter(Boolean)
        : [],
      job_types: [],
    };
  }
  if (mode === "allow_job_types") {
    return {
      mode: "allow_job_types",
      company_ids: [],
      job_types: Array.isArray(o.job_types)
        ? o.job_types.map(String).map((s) => s.trim()).filter(Boolean)
        : [],
    };
  }
  return { mode: "deny_all", company_ids: [], job_types: [] };
}

/**
 * Returns true when the subject is NOT allowed to be inside the zone
 * (i.e. alarm / unauthorized_entry should fire).
 */
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

  if (rules.mode === "deny_all") {
    return true;
  }

  if (rules.mode === "allow_companies") {
    const allowed = rules.company_ids || [];
    if (allowed.length === 0) return true; // misconfigured → treat as deny all
    if (!subject.company_id) return true;
    return !allowed.includes(subject.company_id);
  }

  if (rules.mode === "allow_job_types") {
    const allowed = (rules.job_types || []).map((j) => j.trim().toLowerCase()).filter(Boolean);
    if (allowed.length === 0) return true;
    if (!subject.job_type) return true;
    return !allowed.includes(subject.job_type.trim().toLowerCase());
  }

  // Legacy fallback (deny-lists): empty ⇒ ban everyone
  const workers = legacy?.banned_worker_ids || [];
  const companies = legacy?.banned_company_ids || [];
  const jobs = (legacy?.banned_job_types || []).map((j) => j.trim().toLowerCase()).filter(Boolean);
  if (workers.length === 0 && companies.length === 0 && jobs.length === 0) return true;
  if (subject.worker_id && workers.includes(subject.worker_id)) return true;
  if (subject.company_id && companies.includes(subject.company_id)) return true;
  if (subject.job_type && jobs.includes(subject.job_type.trim().toLowerCase())) return true;
  return false;
}

/** Human-readable summary for zone list badges. */
export function accessRulesSummary(rulesInput: unknown): string {
  const rules = parseAccessRules(rulesInput);
  if (rules.mode === "deny_all") return "전면 통제";
  if (rules.mode === "allow_companies") {
    const n = rules.company_ids?.length || 0;
    return n ? `업체 ${n}곳 허용` : "업체 허용(미설정)";
  }
  const n = rules.job_types?.length || 0;
  return n ? `직종 ${n}개 허용` : "직종 허용(미설정)";
}
