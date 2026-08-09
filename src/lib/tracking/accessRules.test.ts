import { describe, expect, it } from "vitest";
import {
  buildAccessRules,
  isAccessForbidden,
  parseAccessRules,
  zoneCategorySchema,
  ZONE_CATEGORY_OPTIONS,
  DEFAULT_ZONE_CATEGORY,
} from "@/lib/tracking/accessRules";

describe("zone whitelist / blacklist", () => {
  const companyA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const companyB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("ALLOW: only listed company/job may enter", () => {
    const rules = buildAccessRules("ALLOW", [companyA], ["용접공"]);
    expect(isAccessForbidden(rules, { company_id: companyA })).toBe(false);
    expect(isAccessForbidden(rules, { job_type: "용접공" })).toBe(false);
    expect(isAccessForbidden(rules, { company_id: companyB })).toBe(true);
    expect(isAccessForbidden(rules, { job_type: "배관공" })).toBe(true);
    expect(isAccessForbidden(buildAccessRules("ALLOW", [], []), { company_id: companyA })).toBe(true);
  });

  it("DENY: listed targets are blocked; others allowed", () => {
    const rules = buildAccessRules("DENY", [companyA], ["용접공"]);
    expect(isAccessForbidden(rules, { company_id: companyA })).toBe(true);
    expect(isAccessForbidden(rules, { job_type: "용접공" })).toBe(true);
    expect(isAccessForbidden(rules, { company_id: companyB })).toBe(false);
    expect(isAccessForbidden(rules, { job_type: "배관공" })).toBe(false);
  });

  it("DENY: unresolved company_id fail-closes when companies are targeted", () => {
    const rules = buildAccessRules("DENY", [companyA], []);
    expect(isAccessForbidden(rules, { company_id: null })).toBe(true);
    expect(isAccessForbidden(rules, {})).toBe(true);
    // worker_id without company must NOT silently pass a company DENY
    expect(
      isAccessForbidden(rules, {
        worker_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        company_id: null,
      }),
    ).toBe(true);
  });

  it("parses legacy allow_companies as ALLOW", () => {
    const parsed = parseAccessRules({
      mode: "allow_companies",
      company_ids: [companyA],
    });
    expect(parsed.rule_type).toBe("ALLOW");
    expect(parsed.company_ids).toEqual([companyA]);
  });
});

describe("zone category enum", () => {
  it("lists 공정(위험)구역 first as default", () => {
    expect(ZONE_CATEGORY_OPTIONS[0].value).toBe("공정(위험)구역");
    expect(DEFAULT_ZONE_CATEGORY).toBe("공정(위험)구역");
  });

  it("accepts 공정(위험)구역 via Zod", () => {
    expect(zoneCategorySchema.safeParse("공정(위험)구역").success).toBe(true);
    expect(zoneCategorySchema.safeParse("추락위험").success).toBe(true);
    expect(zoneCategorySchema.safeParse("임의구역").success).toBe(false);
  });
});
