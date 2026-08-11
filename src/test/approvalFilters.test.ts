import { describe, it, expect } from "vitest";
import {
  filterApproversForStep,
  preferAuthorCompany,
  buildDefaultStepsForAuthor,
  stepLabelForAuthor,
  isSubmitterApprovalStep,
  dedupeApprovalSteps,
  approvalTimelineGroupKey,
  sequentialDisplayStatus,
  entityTypeLabel,
  WORK_PERMIT_APPROVAL_STEPS,
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
  mk({ out_user_id: "gc-hse", out_company_id: "gc1", out_company_type: "gc", out_position: "HSE_MANAGER", out_display_name: "시공안전" }),
  mk({ out_user_id: "gc-sup", out_company_id: "gc1", out_company_type: "gc", out_position: "SITE_SUPERVISOR", out_display_name: "시공감독" }),
  mk({ out_user_id: "cm", out_company_id: "cl1", out_company_type: "client", out_position: "OWNER_CM", out_display_name: "발주CM" }),
  mk({ out_user_id: "osm", out_company_id: "cl1", out_company_type: "client", out_position: "OWNER_SM", out_display_name: "발주SM" }),
  mk({ out_user_id: "wrong", out_company_id: "sub2", out_company_type: "contractor", out_position: "SITE_SUPERVISOR", out_display_name: "타사감독" }),
];

describe("filterApproversForStep — 협력사 기안", () => {
  const ctx = { authorCompanyId: "sub1", authorCompanyType: "contractor" };

  it("담당자(시공): 기안 협력사 SITE_SUPERVISOR only", () => {
    const r = filterApproversForStep(pool, "contractor_supervisor", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["sup"]);
  });

  it("담당자(시공) fallback: 기안회사 비근로자", () => {
    const odd = [
      mk({
        out_user_id: "odd",
        out_company_id: "sub1",
        out_company_type: "contractor",
        out_position: "UNKNOWN_POS",
        out_role: "project_admin",
      }),
      mk({
        out_user_id: "wk",
        out_company_id: "sub1",
        out_company_type: "contractor",
        out_position: "WORKER",
        out_role: "worker",
      }),
    ];
    const r = filterApproversForStep(odd, "contractor_supervisor", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["odd"]);
  });

  it("담당자(안전): 시공사 HSE only — 협력사 안전 제외", () => {
    const r = filterApproversForStep(pool, "contractor_safety_manager", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["gc-hse"]);
    expect(r.every((x) => x.out_company_type === "gc")).toBe(true);
  });

  it("책임자(소장): 시공사 SITE_MANAGER only — 협력사 소장 제외", () => {
    const r = filterApproversForStep(pool, "contractor_site_director", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["gc-admin"]);
    expect(r.every((x) => x.out_company_type === "gc")).toBe(true);
  });

  it("담당자(안전) fallback: GC 비근로자 (협력사·발주처 제외)", () => {
    const odd = [
      mk({
        out_user_id: "gc-odd",
        out_company_id: "gc1",
        out_company_type: "gc",
        out_position: "UNKNOWN",
        out_role: "project_admin",
      }),
      mk({
        out_user_id: "sub-odd",
        out_company_id: "sub1",
        out_company_type: "contractor",
        out_position: "UNKNOWN",
        out_role: "project_admin",
      }),
    ];
    const r = filterApproversForStep(odd, "contractor_safety_manager", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["gc-odd"]);
  });

  it("담당자(CM)/(SM): 발주처 only", () => {
    expect(filterApproversForStep(pool, "owner_cm", ctx).map((x) => x.out_user_id)).toEqual(["cm"]);
    expect(filterApproversForStep(pool, "owner_sm", ctx).map((x) => x.out_user_id)).toEqual(["osm"]);
  });
});

describe("filterApproversForStep — 시공사 기안", () => {
  const ctx = { authorCompanyId: "gc1", authorCompanyType: "gc" };

  it("담당자(시공): 시공사 내부 SITE_SUPERVISOR", () => {
    const r = filterApproversForStep(pool, "contractor_supervisor", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["gc-sup"]);
  });

  it("담당자(안전)/소장: 시공사 자사", () => {
    expect(filterApproversForStep(pool, "contractor_safety_manager", ctx).map((x) => x.out_user_id)).toEqual([
      "gc-hse",
    ]);
    expect(filterApproversForStep(pool, "contractor_site_director", ctx).map((x) => x.out_user_id)).toEqual([
      "gc-admin",
    ]);
  });

  it("시공사 기안: 타 GC 회사 안전/소장 제외", () => {
    const multi = [
      ...pool,
      mk({
        out_user_id: "other-gc-hse",
        out_company_id: "gc2",
        out_company_type: "gc",
        out_position: "HSE_MANAGER",
        out_display_name: "타시공안전",
      }),
      mk({
        out_user_id: "other-gc-sm",
        out_company_id: "gc2",
        out_company_type: "gc",
        out_position: "SITE_MANAGER",
        out_display_name: "타시공소장",
      }),
    ];
    expect(filterApproversForStep(multi, "contractor_safety_manager", ctx).map((x) => x.out_user_id)).toEqual([
      "gc-hse",
    ]);
    expect(filterApproversForStep(multi, "contractor_site_director", ctx).map((x) => x.out_user_id)).toEqual([
      "gc-admin",
    ]);
  });

  it("preferAuthorCompany puts own company first", () => {
    const list = [
      mk({ out_user_id: "a", out_company_id: "gc2" }),
      mk({ out_user_id: "b", out_company_id: "gc1" }),
    ];
    expect(preferAuthorCompany(list, "gc1").map((x) => x.out_user_id)).toEqual(["b", "a"]);
  });

  it("default work-permit steps omit gc_manager and use stamp labels", () => {
    const steps = buildDefaultStepsForAuthor("work_permit", "gc");
    expect(steps.some((s) => s.position === "gc_manager")).toBe(false);
    expect(WORK_PERMIT_APPROVAL_STEPS.some((s) => s.position === "gc_manager")).toBe(false);
    expect(stepLabelForAuthor("contractor_supervisor", "gc")).toBe("담당자(시공)");
    expect(stepLabelForAuthor("contractor_safety_manager", "contractor")).toBe("담당자(안전)");
    expect(stepLabelForAuthor("contractor_site_director", "contractor")).toBe("책임자(소장)");
    expect(steps.map((s) => s.label)).toEqual([
      "담당자(시공)",
      "담당자(안전)",
      "책임자(소장)",
      "담당자(CM)",
      "담당자(SM)",
    ]);
  });
});

describe("approval timeline helpers — self-lock / sequential", () => {
  it("isSubmitterApprovalStep detects 상신 nodes", () => {
    expect(isSubmitterApprovalStep({ position: "contractor_supervisor" })).toBe(true);
    expect(isSubmitterApprovalStep({ step: "담당자(시공)" })).toBe(true);
    expect(isSubmitterApprovalStep({ step: "시공사 관리감독자 (상신)" })).toBe(true);
    expect(isSubmitterApprovalStep({ position: "owner_sm", step: "담당자(SM)" })).toBe(false);
  });

  it("dedupeApprovalSteps keeps first of identical person+position", () => {
    const steps = [
      { position: "contractor_supervisor", user_id: "a", label: "1" },
      { position: "contractor_supervisor", user_id: "a", label: "dup" },
      { position: "owner_sm", user_id: "b", label: "2" },
    ];
    expect(dedupeApprovalSteps(steps)).toHaveLength(2);
  });

  it("sequentialDisplayStatus forces later 승인 back to 대기 if prior incomplete", () => {
    const rows = [
      { id: "1", position: "contractor_supervisor", status: "승인", step_order: 1 },
      { id: "2", position: "owner_cm", status: "진행중", step_order: 2 },
      { id: "3", position: "owner_sm", status: "승인", step_order: 3 },
    ];
    expect(sequentialDisplayStatus(rows, rows[1])).toBe("진행중");
    expect(sequentialDisplayStatus(rows, rows[2])).toBe("대기");
    expect(approvalTimelineGroupKey({ entity_type: "work_permit", entity_id: "p1" })).toBe(
      "work_permit:p1",
    );
  });

  it("entityTypeLabel covers all approval document types", () => {
    expect(entityTypeLabel("assessment_run")).toBe("위험성평가");
    expect(entityTypeLabel("work_permit")).toBe("작업허가서");
    expect(entityTypeLabel("work_plan")).toBe("작업계획서");
    expect(entityTypeLabel("")).toBe("문서");
    expect(entityTypeLabel("unknown_x")).toBe("unknown_x");
  });
});
