import { describe, it, expect } from "vitest";
import {
  filterApproversForStep,
  buildDefaultStepsForAuthor,
  stepLabelForAuthor,
  type EligibleApprover,
} from "@/lib/approvalRules";

const mk = (partial: Partial<EligibleApprover>): EligibleApprover => ({
  out_user_id: partial.out_user_id || "u1",
  out_display_name: partial.out_display_name || "Tester",
  out_company_id: partial.out_company_id ?? "co1",
  out_company_name: partial.out_company_name || "Co",
  out_company_type: partial.out_company_type || "contractor",
  out_position: partial.out_position || "",
  out_role: partial.out_role || "worker",
});

const pool: EligibleApprover[] = [
  mk({ out_user_id: "sup", out_company_id: "sub1", out_company_type: "contractor", out_position: "SITE_SUPERVISOR", out_display_name: "협력사감독" }),
  mk({ out_user_id: "hse", out_company_id: "sub1", out_company_type: "contractor", out_position: "HSE_MANAGER", out_display_name: "협력사안전" }),
  mk({ out_user_id: "sm", out_company_id: "sub1", out_company_type: "contractor", out_position: "SITE_MANAGER", out_display_name: "협력사소장" }),
  mk({ out_user_id: "gc-admin", out_company_id: "gc1", out_company_type: "gc", out_position: "SITE_MANAGER", out_display_name: "시공소장" }),
  mk({ out_user_id: "gc-sup", out_company_id: "gc1", out_company_type: "gc", out_position: "SITE_SUPERVISOR", out_display_name: "시공감독" }),
  mk({ out_user_id: "cm", out_company_id: "cl1", out_company_type: "client", out_position: "OWNER_CM", out_display_name: "발주CM" }),
  mk({ out_user_id: "osm", out_company_id: "cl1", out_company_type: "client", out_position: "OWNER_SM", out_display_name: "발주SM" }),
  // 타 협력사 관리감독자 — 기안자 company_id 불일치로 1단계에서 제외
  mk({ out_user_id: "wrong", out_company_id: "sub2", out_company_type: "contractor", out_position: "SITE_SUPERVISOR", out_display_name: "타사감독" }),
];

describe("filterApproversForStep — 협력사 기안", () => {
  const ctx = { authorCompanyId: "sub1", authorCompanyType: "contractor" };

  it("1단계: 기안자 회사 + SITE_SUPERVISOR only", () => {
    const r = filterApproversForStep(pool, "contractor_supervisor", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["sup"]);
  });

  it("2단계: HSE_MANAGER only", () => {
    const r = filterApproversForStep(pool, "contractor_safety_manager", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["hse"]);
  });

  it("3단계: SITE_MANAGER only", () => {
    const r = filterApproversForStep(pool, "contractor_site_director", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["sm"]);
  });

  it("4단계: GC only", () => {
    const r = filterApproversForStep(pool, "gc_manager", ctx);
    expect(r.every((x) => x.out_company_type === "gc")).toBe(true);
    expect(r.some((x) => x.out_user_id === "gc-admin")).toBe(true);
  });

  it("5단계: OWNER_CM only (client)", () => {
    const r = filterApproversForStep(pool, "owner_cm", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["cm"]);
  });

  it("6단계: OWNER_SM only (client)", () => {
    const r = filterApproversForStep(pool, "owner_sm", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["osm"]);
  });
});

describe("filterApproversForStep — 시공사 기안", () => {
  const ctx = { authorCompanyId: "gc1", authorCompanyType: "gc" };

  it("1단계: 시공사 내부 SITE_SUPERVISOR only (협력사 제외)", () => {
    const r = filterApproversForStep(pool, "contractor_supervisor", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["gc-sup"]);
  });

  it("gc_manager step returns empty (skipped for GC author)", () => {
    const r = filterApproversForStep(pool, "gc_manager", ctx);
    expect(r).toEqual([]);
  });

  it("default steps omit gc_manager and use 시공사 labels", () => {
    const steps = buildDefaultStepsForAuthor("work_permit", "gc");
    expect(steps.some((s) => s.position === "gc_manager")).toBe(false);
    expect(stepLabelForAuthor("contractor_supervisor", "gc")).toContain("시공사");
  });
});
