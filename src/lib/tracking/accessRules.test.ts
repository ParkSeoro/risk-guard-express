import { describe, expect, it } from "vitest";
import { buildAccessRules, isAccessForbidden, parseAccessRules } from "@/lib/tracking/accessRules";

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

  it("parses legacy allow_companies as ALLOW", () => {
    const parsed = parseAccessRules({
      mode: "allow_companies",
      company_ids: [companyA],
    });
    expect(parsed.rule_type).toBe("ALLOW");
    expect(parsed.company_ids).toEqual([companyA]);
  });
});
