/**
 * Restricted-zone access control (JSONB on restricted_zones.access_rules + rule_type column).
 *
 * JSON shape (v2):
 * {
 *   "rule_type": "ALLOW" | "DENY",
 *   "company_ids": ["uuid", ...],
 *   "job_types": ["용접공", ...]
 * }
 *
 * - ALLOW (Whitelist): only listed companies/job types may enter; others forbidden
 * - DENY  (Blacklist): listed companies/job types are forbidden; others allowed
 *
 * Legacy modes (deny_all / allow_companies / allow_job_types) still parsed.
 */

import { STANDARD_JOB_TYPES } from "@/lib/jobCategories";
import { z } from "zod";

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

/** 구역 유형(SSOT) — 모달 Select / Zod / DB 허용 값 */
export const ZONE_CATEGORY_OPTIONS = [
  { value: "공정(위험)구역", label: "공정(위험)구역" },
  { value: "추락위험", label: "추락위험" },
  { value: "화재위험", label: "화재위험" },
  { value: "밀폐공간", label: "밀폐공간" },
  { value: "중장비반입", label: "중장비반입" },
  { value: "감전위험", label: "감전위험" },
  { value: "기타", label: "기타" },
] as const;

export type ZoneCategory = (typeof ZONE_CATEGORY_OPTIONS)[number]["value"];

export const ZONE_CATEGORY_VALUES = ZONE_CATEGORY_OPTIONS.map((o) => o.value) as [
  ZoneCategory,
  ...ZoneCategory[],
];

export const DEFAULT_ZONE_CATEGORY: ZoneCategory = "공정(위험)구역";

/** Zod: zone_category / 구역 유형 허용 enum */
export const zoneCategorySchema = z.enum(ZONE_CATEGORY_VALUES, {
  errorMap: () => ({ message: "유효한 구역 유형을 선택하세요" }),
});

export function isZoneCategory(value: string | null | undefined): value is ZoneCategory {
  return !!value && (ZONE_CATEGORY_VALUES as readonly string[]).includes(value);
}

export const ZONE_COLOR_OPTIONS = [
  { value: "#ef4444", label: "Red", swatch: "bg-red-500" },
  { value: "#eab308", label: "Yellow", swatch: "bg-yellow-500" },
  { value: "#3b82f6", label: "Blue", swatch: "bg-blue-500" },
] as const;

export type ZoneColor = (typeof ZONE_COLOR_OPTIONS)[number]["value"];

/** 표준 직종 SSOT */
export const JOB_TYPE_OPTIONS = STANDARD_JOB_TYPES;

export const DEFAULT_ACCESS_RULES: AccessRules = {
  rule_type: "DENY",
  company_ids: [],
  job_types: [],
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String).map((s) => s.trim()).filter(Boolean);
}

/** Normalize legacy + v2 access_rules into { rule_type, company_ids, job_types }. */
export function parseAccessRules(raw: unknown): AccessRules {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ACCESS_RULES };
  const o = raw as Record<string, unknown>;

  // v2 explicit rule_type
  if (o.rule_type === "ALLOW" || o.rule_type === "DENY") {
    return {
      rule_type: o.rule_type,
      company_ids: asStringArray(o.company_ids),
      job_types: asStringArray(o.job_types),
    };
  }

  // Legacy modes
  if (o.mode === "allow_companies") {
    return {
      rule_type: "ALLOW",
      company_ids: asStringArray(o.company_ids),
      job_types: [],
    };
  }
  if (o.mode === "allow_job_types") {
    return {
      rule_type: "ALLOW",
      company_ids: [],
      job_types: asStringArray(o.job_types),
    };
  }
  if (o.mode === "deny_all") {
    return { rule_type: "DENY", company_ids: [], job_types: [] };
  }

  return { ...DEFAULT_ACCESS_RULES };
}

export function buildAccessRules(
  ruleType: ZoneRuleType,
  companyIds: string[],
  jobTypes: string[],
): AccessRules {
  return {
    rule_type: ruleType,
    company_ids: [...new Set(companyIds.filter(Boolean))],
    job_types: [...new Set(jobTypes.map((j) => j.trim()).filter(Boolean))],
  };
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
    rule_type?: string | null;
  },
): boolean {
  const rules = parseAccessRules(rulesInput);
  // Prefer column if JSON missing rule_type but column provided
  if (
    legacy?.rule_type === "ALLOW" ||
    legacy?.rule_type === "DENY"
  ) {
    if (!("rule_type" in ((rulesInput as object) || {}))) {
      rules.rule_type = legacy.rule_type;
    }
  }

  const hasTargets =
    (rules.company_ids?.length || 0) > 0 || (rules.job_types?.length || 0) > 0;

  if (rules.rule_type === "ALLOW") {
    // Whitelist: empty targets ⇒ nobody allowed
    if (!hasTargets) return true;
    return !subjectMatchesTargets(rules, subject);
  }

  // DENY blacklist
  if (!hasTargets) {
    // Empty DENY list: treat as legacy deny_all (everyone forbidden)
    // unless only legacy ban lists exist
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

/** Short label for badges. */
export function accessRulesSummary(rulesInput: unknown, ruleTypeCol?: string | null): string {
  const rules = parseAccessRules(rulesInput);
  const rt = (ruleTypeCol === "ALLOW" || ruleTypeCol === "DENY" ? ruleTypeCol : rules.rule_type) as ZoneRuleType;
  const nc = rules.company_ids?.length || 0;
  const nj = rules.job_types?.length || 0;
  if (rt === "ALLOW") {
    if (nc + nj === 0) return "허용(대상 미설정)";
    return `허용 · 업체 ${nc} · 직종 ${nj}`;
  }
  if (nc + nj === 0) return "전면 통제";
  return `차단 · 업체 ${nc} · 직종 ${nj}`;
}

export function ruleTypeLabel(rt: ZoneRuleType | string | null | undefined): string {
  return rt === "ALLOW" ? "허용" : "차단";
}
