import { describe, expect, it } from "vitest";
import { isLockedAssessmentRunStatus } from "@/lib/riskAutoGenJob";

describe("isLockedAssessmentRunStatus", () => {
  it("locks approved, discarded, and in-approval runs", () => {
    expect(isLockedAssessmentRunStatus("승인완료")).toBe(true);
    expect(isLockedAssessmentRunStatus("폐기")).toBe(true);
    expect(isLockedAssessmentRunStatus("결재진행")).toBe(true);
  });

  it("does not lock writable statuses including 반려", () => {
    for (const status of [
      "작성중",
      "제출됨",
      "검증중",
      "보완요청",
      "보완중",
      "반려",
      "검증완료",
    ]) {
      expect(isLockedAssessmentRunStatus(status)).toBe(false);
    }
    expect(isLockedAssessmentRunStatus(null)).toBe(false);
    expect(isLockedAssessmentRunStatus("")).toBe(false);
  });
});
