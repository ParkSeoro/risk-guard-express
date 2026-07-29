import { describe, expect, it } from "vitest";
import { isApprovedAssessmentStatus } from "@/lib/safetyWorkBundle";

describe("safetyWorkBundle helpers", () => {
  it("recognizes approved assessment statuses", () => {
    expect(isApprovedAssessmentStatus("승인완료")).toBe(true);
    expect(isApprovedAssessmentStatus("approved")).toBe(true);
    expect(isApprovedAssessmentStatus("작성중")).toBe(false);
    expect(isApprovedAssessmentStatus(null)).toBe(false);
  });
});
