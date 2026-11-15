import { describe, expect, it } from "vitest";
import { canEditClientLedger, canEditCtpa, canViewLegalCompanyDocs } from "@/lib/legalDutyAccess";

describe("legal duty company docs", () => {
  it("shows the ledger and CTPA tabs to a site supervisor", () => {
    expect(canViewLegalCompanyDocs({
      isMaster: false,
      userRole: "site_supervisor",
      userCompanyType: "gc",
    })).toBe(true);
  });

  it("hides those tabs from a worker", () => {
    expect(canViewLegalCompanyDocs({
      isMaster: false,
      userRole: "worker",
      userCompanyType: "contractor",
    })).toBe(false);
  });

  it("lets a site supervisor read the ledger without confirming it", () => {
    const opts = { isMaster: false, userRole: "site_supervisor", userCompanyType: "gc" };
    expect(canViewLegalCompanyDocs(opts)).toBe(true);
    expect(canEditClientLedger(opts)).toBe(false);
    expect(canEditCtpa({ ...opts, userPosition: "SITE_SUPERVISOR" })).toBe(false);
  });

  it("lets a site manager write CTPA records", () => {
    expect(canEditCtpa({
      isMaster: false,
      userRole: "site_manager",
      userPosition: "SITE_MANAGER",
    })).toBe(true);
  });
});
