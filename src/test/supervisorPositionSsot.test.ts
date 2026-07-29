import { describe, it, expect } from "vitest";
import {
  defaultPositionForRole,
  defaultRoleForPosition,
  syncMembershipRolePosition,
} from "@/lib/projectPositions";
import { filterApproversForStep, type EligibleApprover } from "@/lib/approvalRules";

describe("role ↔ position SSOT", () => {
  it("maps site_supervisor ↔ SITE_SUPERVISOR", () => {
    expect(defaultRoleForPosition("SITE_SUPERVISOR")).toBe("site_supervisor");
    expect(defaultPositionForRole("site_supervisor")).toBe("SITE_SUPERVISOR");
  });

  it("maps supervisor ↔ SUPERVISOR (감리)", () => {
    expect(defaultRoleForPosition("SUPERVISOR")).toBe("supervisor");
    expect(defaultPositionForRole("supervisor")).toBe("SUPERVISOR");
  });

  it("syncs position when role changes to site_supervisor", () => {
    expect(
      syncMembershipRolePosition({ field: "role_new", value: "site_supervisor" }),
    ).toEqual({ role_new: "site_supervisor", position_new: "SITE_SUPERVISOR" });
  });

  it("syncs role when position changes to SITE_SUPERVISOR", () => {
    expect(
      syncMembershipRolePosition({ field: "position_new", value: "SITE_SUPERVISOR" }),
    ).toEqual({ position_new: "SITE_SUPERVISOR", role_new: "site_supervisor" });
  });
});

describe("filterApproversForStep — role/position drift", () => {
  const mk = (partial: Partial<EligibleApprover>): EligibleApprover => ({
    out_user_id: partial.out_user_id || "u1",
    out_display_name: partial.out_display_name || "Tester",
    out_company_id: partial.out_company_id ?? "gc1",
    out_company_name: partial.out_company_name || "Co",
    out_company_type: partial.out_company_type || "gc",
    out_position: partial.out_position || "",
    out_role: partial.out_role || "worker",
  });

  it("includes site_supervisor even when position drifted to CONSTRUCTION_MGR", () => {
    const pool = [
      mk({
        out_user_id: "drift",
        out_position: "CONSTRUCTION_MGR",
        out_role: "site_supervisor",
        out_display_name: "표류관리감독",
      }),
      mk({
        out_user_id: "ok",
        out_position: "SITE_SUPERVISOR",
        out_role: "site_supervisor",
        out_display_name: "정상관리감독",
      }),
    ];
    const r = filterApproversForStep(pool, "contractor_supervisor", {
      authorCompanyId: "gc1",
      authorCompanyType: "gc",
    });
    expect(r.map((x) => x.out_user_id).sort()).toEqual(["drift", "ok"]);
  });

  it("감리(SUPERVISOR)는 strict 매칭 제외 — SITE_SUPERVISOR 없을 때만 soft fallback", () => {
    const pool = [
      mk({
        out_user_id: "gamri",
        out_position: "SUPERVISOR",
        out_role: "supervisor",
        out_display_name: "감리",
      }),
      mk({
        out_user_id: "ok",
        out_position: "SITE_SUPERVISOR",
        out_role: "site_supervisor",
        out_display_name: "관리감독",
      }),
    ];
    const withSs = filterApproversForStep(pool, "contractor_supervisor", {
      authorCompanyId: "gc1",
      authorCompanyType: "gc",
    });
    // strict hit on SITE_SUPERVISOR — 감리 제외
    expect(withSs.map((x) => x.out_user_id)).toEqual(["ok"]);

    const onlyGamri = filterApproversForStep(
      pool.filter((x) => x.out_user_id === "gamri"),
      "contractor_supervisor",
      { authorCompanyId: "gc1", authorCompanyType: "gc" },
    );
    // no SITE_SUPERVISOR → soft fallback keeps same-company non-worker
    expect(onlyGamri.map((x) => x.out_user_id)).toEqual(["gamri"]);
  });
});
