import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatPendingApprovalMeta, mapApprovalActionError, pendingInboxTitle, groupedDocumentStatus } from "@/lib/approvalInboxMeta";

describe("get_my_pending_entity_approvals company_name", () => {
  it("uses the document author company, not the current approver company", () => {
    const src = readFileSync(
      "supabase/migrations/20260907070000_pending_inbox_author_company.sql",
      "utf8",
    );
    expect(src).toMatch(/wpc\.name/);
    expect(src).toMatch(/author_user_id/);
    expect(src).toMatch(/contractor_company/);
    expect(src).toContain("WHEN a.entity_type='work_plan' THEN COALESCE(NULLIF(wpc.name,''), NULLIF(author_co.name,''), a.company_name, '')");
    expect(src).toContain("WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN COALESCE(NULLIF(author_co.name,''), a.company_name, '')");
  });
});

describe("formatPendingApprovalMeta", () => {
  it("distinguishes two same-title permits by company, crew, and resubmit", () => {
    expect(
      formatPendingApprovalMeta({
        entity_type: "work_permit",
        entity_date: "2026-08-27",
        step: "담당자(SM)",
        company_name: "정원이엔씨",
        personnel_count: 0,
        resubmit_count: 1,
      }),
    ).toBe("2026-08-27 · 담당자(SM) · 정원이엔씨 · 인원 0명 · 재상신 1회");

    expect(
      formatPendingApprovalMeta({
        entity_type: "work_permit",
        entity_date: "2026-08-27",
        step: "담당자(SM)",
        company_name: "정원이엔씨",
        personnel_count: 5,
        resubmit_count: 0,
      }),
    ).toBe("2026-08-27 · 담당자(SM) · 정원이엔씨 · 인원 5명");
  });
});

describe("pendingInboxTitle", () => {
  it("uses period_label from RPC and does not show dash for blank feedback", () => {
    expect(
      pendingInboxTitle({
        entity_type: "assessment_run_feedback",
        entity_title: "2026-09 주간",
      }),
    ).toBe("2026-09 주간 · 이행 확인");
    expect(
      pendingInboxTitle({
        entity_type: "assessment_run_feedback",
        entity_title: "",
      }),
    ).toBe("위험성평가 · 이행 확인");
    expect(
      pendingInboxTitle({
        entity_type: "assessment_run",
        entity_title: "2026-09 주간",
      }),
    ).toBe("2026-09 주간 · 위평 작성");
    expect(pendingInboxTitle({ entity_type: "work_permit", entity_title: "" })).toBe("-");
  });
});

describe("mapApprovalActionError", () => {
  it("maps deleted-entity and direct-approve lock codes", () => {
    expect(mapApprovalActionError("ENTITY_DELETED")).toBe("삭제된 문서는 결재할 수 없습니다.");
    expect(mapApprovalActionError("WORK_PERMIT_APPROVAL_RPC_REQUIRED")).toContain("결재선");
  });

  it("maps submitted_document_locked to Korean", () => {
    expect(mapApprovalActionError("submitted_document_locked")).toMatch(/잠겨/);
  });
});

describe("groupedDocumentStatus", () => {
  it("does not show parent 승인완료 while feedback SM is still open", () => {
    expect(
      groupedDocumentStatus({ status: "승인완료" }, [
        { entity_type: "assessment_run_feedback", status: "승인" },
        { entity_type: "assessment_run_feedback", status: "진행중" },
      ]),
    ).toBe("조치 결재중");
    expect(
      groupedDocumentStatus({ status: "승인완료" }, [
        { entity_type: "assessment_run_feedback", status: "승인" },
        { entity_type: "assessment_run_feedback", status: "승인" },
      ]),
    ).toBe("조치 확인 완료");
    expect(groupedDocumentStatus({ status: "승인완료" }, [{ entity_type: "assessment_run", status: "승인" }])).toBe(
      "승인완료",
    );
  });
});
