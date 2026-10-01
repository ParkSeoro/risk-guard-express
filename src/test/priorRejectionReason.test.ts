import { describe, expect, it } from "vitest";
import {
  currentRejectionNotes,
  latestResubmitNotes,
  priorRejectionNotes,
  visibleDocumentRejection,
} from "@/lib/priorRejectionReason";

const rejected = {
  id: "r1",
  status: "반려",
  comment: "장비명 기재 누락",
  approver_name: "김안전",
  step: "안전관리자",
  approval_version: 1,
  step_order: 2,
};

const resubmit = [
  rejected,
  { id: "n1", status: "승인", comment: "", approval_version: 2, step_order: 1, step: "상신" },
  { id: "n2", status: "진행중", comment: "", approval_version: 2, step_order: 2, step: "현장소장" },
];

describe("prior rejection notes", () => {
  it("keeps the rejection on the round that was rejected", () => {
    expect(currentRejectionNotes([rejected]).map((n) => n.comment)).toEqual(["장비명 기재 누락"]);
    expect(priorRejectionNotes([rejected])).toEqual([]);
  });

  it("shows the earlier rejection once a new round is in flight", () => {
    expect(currentRejectionNotes(resubmit)).toEqual([]);
    expect(priorRejectionNotes(resubmit).map((n) => n.comment)).toEqual(["장비명 기재 누락"]);
    expect(visibleDocumentRejection(resubmit)?.title).toBe("이전 반려 사유");
  });

  it("reads the resubmit reason from the closed round, not from 상신 완료", () => {
    const steps = [
      rejected,
      {
        id: "c1",
        status: "취소",
        comment: "[상신 완료]\n[재상신] 장비명을 기재했습니다",
        approver_name: "김안전",
        approval_version: 1,
        step_order: 3,
      },
      { id: "n1", status: "승인", comment: "[상신 완료]", approval_version: 2, step_order: 1 },
    ];
    expect(latestResubmitNotes(steps).map((n) => n.comment)).toEqual(["장비명을 기재했습니다"]);
    expect(latestResubmitNotes(steps)[0]?.approverName).toBe("");
  });

  it("does not surface an old rejection after the new round is fully approved", () => {
    const approved = [
      rejected,
      { id: "a1", status: "승인", approval_version: 2, step_order: 1 },
      { id: "a2", status: "승인", approval_version: 2, step_order: 2 },
    ];
    expect(visibleDocumentRejection(approved)).toBeNull();
  });
});
