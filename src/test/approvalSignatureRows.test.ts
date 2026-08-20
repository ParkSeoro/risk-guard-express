import { describe, it, expect } from "vitest";
import { buildAssessmentSignatureRows, LEGACY_WORK_PLAN_SIG_SLOTS, matchesWorkPlanApproval } from "@/lib/approvalSignatureRows";

describe("buildAssessmentSignatureRows", () => {
  it("uses submitted approvals (all steps) and ignores 취소", () => {
    const rows = buildAssessmentSignatureRows({
      approvals: [
        {
          step: "담당자(시공)",
          position: "contractor_supervisor",
          approver_name: "김기안",
          company_name: "하이테크",
          status: "승인",
          approved_at: "2026-08-01T00:00:00Z",
          approval_version: 1,
          step_order: 0,
        },
        {
          step: "담당자(SM)",
          position: "owner_sm",
          approver_name: "박SM",
          company_name: "발주",
          status: "대기",
          approved_at: null,
          approval_version: 1,
          step_order: 4,
        },
        {
          step: "담당자(시공)",
          position: "contractor_supervisor",
          approver_name: "이전",
          company_name: "하이테크",
          status: "취소",
          approval_version: 1,
          step_order: 0,
        },
      ],
      draftSteps: [{ label: "작성", position: "x", user_name: "무시" }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].step).toBe("담당자(시공)");
    expect(rows[0].approver_name).toBe("김기안");
    expect(rows[0].position_label).toBe("관리감독자");
    expect(rows[1].step).toBe("담당자(SM)");
    expect(rows[1].position_label).toBe("발주처 SM");
  });

  it("before submit: uses saved draft steps, not 작성/검토/승인 3칸", () => {
    const rows = buildAssessmentSignatureRows({
      approvals: [],
      draftSteps: [
        { label: "담당자(시공)", position: "contractor_supervisor", user_name: "김기안", company_name: "하이테크" },
        { label: "담당자(안전)", position: "contractor_safety_manager", user_name: "이안전", company_name: "시공사A" },
        { label: "책임자(소장)", position: "contractor_site_director", user_name: "박소장", company_name: "시공사A" },
        { label: "담당자(CM)", position: "owner_cm", user_name: "최CM", company_name: "발주" },
        { label: "담당자(SM)", position: "owner_sm", user_name: "정SM", company_name: "발주" },
      ],
    });
    expect(rows.map((r) => r.step)).toEqual([
      "담당자(시공)",
      "담당자(안전)",
      "책임자(소장)",
      "담당자(CM)",
      "담당자(SM)",
    ]);
    expect(rows.every((r) => r.status === "")).toBe(true);
    expect(rows.some((r) => r.step === "작성" || r.step === "검토" || r.step === "승인")).toBe(false);
  });

  it("no approvals and no draft → empty (no participant 5-role fallback)", () => {
    expect(buildAssessmentSignatureRows({ approvals: [], draftSteps: [] })).toEqual([]);
  });

  it("work-plan 승인완료 uses entity_id rows, not run_id or 작성/안전관리자/현장대리인/최종승인 slots", () => {
    const planId = "239a575f-3294-4c85-a43f-9577d948cb35";
    const stored = [
      { entity_type: "work_plan", entity_id: planId, run_id: null, step: "담당자(시공)", position: "contractor_supervisor", approver_name: "이진남", company_name: "정원이엔씨", status: "승인", approval_version: 1, step_order: 1 },
      { entity_type: "work_plan", entity_id: planId, run_id: null, step: "담당자(안전)", position: "contractor_safety_manager", approver_name: "김재현", company_name: "정원이엔씨", status: "승인", approval_version: 1, step_order: 2 },
      { entity_type: "work_plan", entity_id: planId, run_id: null, step: "책임자(소장)", position: "contractor_site_director", approver_name: "최경호", company_name: "정원이엔씨", status: "승인", approval_version: 1, step_order: 3 },
      { entity_type: "work_plan", entity_id: planId, run_id: null, step: "담당자(CM)", position: "owner_cm", approver_name: "이철훈", company_name: "에어리퀴드코리아", status: "승인", approval_version: 1, step_order: 4 },
      { entity_type: "work_plan", entity_id: planId, run_id: null, step: "담당자(SM)", position: "owner_sm", approver_name: "박서로", company_name: "에어리퀴드코리아", status: "승인", approval_version: 1, step_order: 5 },
    ];
    expect(stored.every((r) => matchesWorkPlanApproval(planId, r))).toBe(true);
    expect(stored.some((r) => r.run_id === planId)).toBe(false);

    const rows = buildAssessmentSignatureRows({ approvals: stored });
    expect(rows.map((r) => r.step)).toEqual([
      "담당자(시공)",
      "담당자(안전)",
      "책임자(소장)",
      "담당자(CM)",
      "담당자(SM)",
    ]);
    expect(rows.map((r) => r.approver_name)).toEqual(["이진남", "김재현", "최경호", "이철훈", "박서로"]);
    expect(rows.some((r) => LEGACY_WORK_PLAN_SIG_SLOTS.includes(r.step))).toBe(false);
  });
});
