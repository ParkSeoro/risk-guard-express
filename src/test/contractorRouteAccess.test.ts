import { describe, expect, it } from "vitest";
import {
  isAllowedForContractor,
  normalizeAdminPathname,
} from "@/lib/contractorRouteAccess";

describe("contractorRouteAccess", () => {
  it("normalizes /app/admin to logical root", () => {
    expect(normalizeAdminPathname("/app/admin")).toBe("/");
    expect(normalizeAdminPathname("/app/admin/")).toBe("/");
    expect(normalizeAdminPathname("/app/admin/work-permits")).toBe("/work-permits");
    expect(normalizeAdminPathname("/work-permits")).toBe("/work-permits");
  });

  it("allows partner admin shell home and permit/tbm paths", () => {
    expect(isAllowedForContractor("/app/admin")).toBe(true);
    expect(isAllowedForContractor("/app/admin/")).toBe(true);
    expect(isAllowedForContractor("/app/admin/work-permits")).toBe(true);
    expect(isAllowedForContractor("/app/admin/work-permits/abc")).toBe(true);
    expect(isAllowedForContractor("/app/admin/approvals")).toBe(true);
    expect(isAllowedForContractor("/app/admin/tbm-logs")).toBe(true);
    expect(isAllowedForContractor("/app/admin/work-plans")).toBe(true);
    expect(isAllowedForContractor("/work-permits")).toBe(true);
  });

  it("allows sidebar partner menus that were previously blocked under /app/admin", () => {
    expect(isAllowedForContractor("/app/admin/ai-assistant")).toBe(true);
    expect(isAllowedForContractor("/app/admin/verification-center")).toBe(true);
    expect(isAllowedForContractor("/app/admin/work-stop")).toBe(true);
  });

  it("denies partner access to gc-only admin tools", () => {
    expect(isAllowedForContractor("/app/admin/site-readiness")).toBe(false);
    expect(isAllowedForContractor("/app/admin/companies")).toBe(false);
    expect(isAllowedForContractor("/app/admin/settings")).toBe(false);
  });
});
