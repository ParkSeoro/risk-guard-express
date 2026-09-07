import { describe, it, expect } from "vitest";
import {
  localizeNotificationText,
  notificationPreview,
  notificationTitle,
} from "@/lib/notificationText";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";

describe("notificationPreview", () => {
  it("prefers message, then body (legacy reject alerts)", () => {
    expect(notificationPreview({ message: "사유: 누락", body: "누락" })).toBe("사유: 누락");
    expect(notificationPreview({ message: "", body: "위험상황, 개선대책 누락" })).toBe(
      "위험상황, 개선대책 누락",
    );
    expect(notificationPreview({ message: "  ", body: "  " })).toBe("");
  });

  it("rewrites raw assessment_run_feedback keys to the approval-screen label", () => {
    expect(localizeNotificationText("assessment_run_feedback 결재 요청")).toBe(
      "위험성평가 피드백(조치) 결재 요청",
    );
    expect(
      notificationTitle({ title: "assessment_run_feedback 결재 요청" }),
    ).toBe("위험성평가 피드백(조치) 결재 요청");
    expect(
      notificationPreview({
        message: "결재 요청: assessment_run_feedback이(가) 도착했습니다.",
      }),
    ).toBe("결재 요청: 위험성평가 피드백(조치)이(가) 도착했습니다.");
    expect(localizeNotificationText("assessment_run 결재 요청")).toBe("위험성평가 결재 요청");
  });
});

describe("approval reject notification routes", () => {
  it("opens the risk assessment document when related_id is present", () => {
    expect(
      resolveNotificationRoute(
        { type: "approval_rejected", related_type: "assessment_run", related_id: "run-1" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/risk-assessment/run-1");
    expect(
      resolveNotificationRoute(
        { type: "approval_rejected", related_type: "assessment_run", related_id: "run-1" },
        { mobileShell: false },
      ),
    ).toBe("/app/admin/assessment-run/run-1");
  });

  it("falls back to approvals inbox when the legacy alert has no document id", () => {
    expect(
      resolveNotificationRoute({ type: "approval_rejected" }, { mobileShell: true }),
    ).toBe("/app/worker/approvals");
  });

  it("opens the risk assessment document for feedback approval alerts", () => {
    expect(
      resolveNotificationRoute(
        { type: "approval_request", related_type: "assessment_run_feedback", related_id: "run-1" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/risk-assessment/run-1?tab=feedback");
  });
});
