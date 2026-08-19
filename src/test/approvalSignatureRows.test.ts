import { describe, it, expect } from "vitest";
import { buildAssessmentSignatureRows } from "@/lib/approvalSignatureRows";

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
});
