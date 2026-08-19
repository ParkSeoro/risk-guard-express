import { describe, expect, it } from "vitest";
import { isLockedAssessmentRunStatus } from "@/lib/riskAutoGenJob";

describe("isLockedAssessmentRunStatus", () => {
  it("locks approved and discarded runs", () => {
    expect(isLockedAssessmentRunStatus("승인완료")).toBe(true);
    expect(isLockedAssessmentRunStatus("폐기")).toBe(true);
  });

  it("does not lock writable statuses", () => {
    expect(isLockedAssessmentRunStatus("작성중")).toBe(false);
    expect(isLockedAssessmentRunStatus("결재진행")).toBe(false);
    expect(isLockedAssessmentRunStatus("반려")).toBe(false);
    expect(isLockedAssessmentRunStatus(null)).toBe(false);
    expect(isLockedAssessmentRunStatus("")).toBe(false);
  });
});
