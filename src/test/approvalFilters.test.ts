import { describe, it, expect } from "vitest";
import {
  filterApproversForStep,
  buildDefaultStepsForAuthor,
  stepLabelForAuthor,
  isSubmitterApprovalStep,
  dedupeApprovalSteps,
  approvalTimelineGroupKey,
  sequentialDisplayStatus,
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

  it("1단계: 기안자 회사 SITE_SUPERVISOR only (SSOT)", () => {
    const r = filterApproversForStep(pool, "contractor_supervisor", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["sup"]);
  });

  it("1단계 fallback: allowlist 미스여도 기안회사 비근로자 허용", () => {
    const odd = [
      mk({
        out_user_id: "odd",
        out_company_id: "sub1",
        out_company_type: "contractor",
        out_position: "UNKNOWN_POS",
        out_role: "project_admin",
        out_display_name: "기타관리",
      }),
      mk({
        out_user_id: "wk",
        out_company_id: "sub1",
        out_company_type: "contractor",
        out_position: "WORKER",
        out_role: "worker",
        out_display_name: "근로자",
      }),
    ];
    const r = filterApproversForStep(odd, "contractor_supervisor", ctx);
    expect(r.map((x) => x.out_user_id)).toEqual(["odd"]);
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
    expect(r.every((x) => x.out_company_id === "gc1")).toBe(true);
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

describe("approval timeline helpers — self-lock / sequential", () => {
  it("isSubmitterApprovalStep detects 상신 nodes", () => {
    expect(isSubmitterApprovalStep({ position: "contractor_supervisor" })).toBe(true);
    expect(isSubmitterApprovalStep({ step: "시공사 관리감독자 (상신)" })).toBe(true);
    expect(isSubmitterApprovalStep({ position: "owner_sm", step: "발주처 SM" })).toBe(false);
  });

  it("dedupeApprovalSteps removes twin position+user copies", () => {
    const steps = [
      { position: "contractor_supervisor", user_id: "a", label: "시공사 상신" },
      { position: "contractor_safety_manager", user_id: "b", label: "시공사 검토" },
      { position: "contractor_supervisor", user_id: "a", label: "협력사 상신" },
    ];
    const d = dedupeApprovalSteps(steps);
    expect(d).toHaveLength(2);
    expect(d.map((s) => s.label)).toEqual(["시공사 상신", "시공사 검토"]);
  });

  it("approvalTimelineGroupKey isolates entity docs", () => {
    expect(approvalTimelineGroupKey({ entity_type: "work_permit", entity_id: "p1" })).toBe("work_permit:p1");
    expect(approvalTimelineGroupKey({ run_id: "r1" })).toBe("run:r1");
    expect(approvalTimelineGroupKey({ entity_type: "work_permit", entity_id: "p1" }))
      .not.toBe(approvalTimelineGroupKey({ entity_type: "work_permit", entity_id: "p2" }));
  });

  it("sequentialDisplayStatus never paints later steps complete early", () => {
    const steps = [
      { step_order: 1, status: "진행중" },
      { step_order: 2, status: "승인" },
      { step_order: 3, status: "대기" },
    ];
    expect(sequentialDisplayStatus(steps, steps[1])).toBe("대기");
    expect(sequentialDisplayStatus(steps, steps[0])).toBe("진행중");
  });
});
