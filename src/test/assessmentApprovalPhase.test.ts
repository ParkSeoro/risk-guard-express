import { describe, expect, it } from "vitest";
import {
  feedbackStatusBadge,
  inboxPeriodTitle,
  raApprovalEntityLabel,
} from "@/lib/assessmentApprovalPhase";

describe("assessmentApprovalPhase", () => {
  it("keeps write and feedback labels distinct", () => {
    expect(raApprovalEntityLabel("assessment_run")).toBe("위험성평가 · 위평 작성");
    expect(raApprovalEntityLabel("assessment_run_feedback")).toBe("위험성평가 · 이행 확인");
  });

  it("appends the phase to the same period label", () => {
    expect(inboxPeriodTitle({ entityType: "assessment_run", periodLabel: "09월 2주차" })).toBe(
      "09월 2주차 · 위평 작성",
    );
    expect(
      inboxPeriodTitle({ entityType: "assessment_run_feedback", periodLabel: "09월 2주차" }),
    ).toBe("09월 2주차 · 이행 확인");
  });

  it("does not reuse 결재진행 / 승인완료 for feedback", () => {
    expect(feedbackStatusBadge("pending_approval")).toBe("조치 결재중");
    expect(feedbackStatusBadge("closed")).toBe("조치 확인 완료");
    expect(feedbackStatusBadge("none")).toBeNull();
  });
});
