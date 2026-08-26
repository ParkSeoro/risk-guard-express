import { describe, expect, it } from "vitest";
import { formatPendingApprovalMeta, mapApprovalActionError } from "@/lib/approvalInboxMeta";

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

describe("mapApprovalActionError", () => {
  it("maps deleted-entity and direct-approve lock codes", () => {
    expect(mapApprovalActionError("ENTITY_DELETED")).toBe("삭제된 문서는 결재할 수 없습니다.");
    expect(mapApprovalActionError("WORK_PERMIT_APPROVAL_RPC_REQUIRED")).toContain("결재선");
    expect(mapApprovalActionError("WORK_PERMIT_LINE_NOT_APPROVED")).toContain("반려");
  });
});
