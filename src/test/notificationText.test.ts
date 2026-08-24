import { describe, it, expect } from "vitest";
import { notificationPreview } from "@/lib/notificationText";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";

describe("notificationPreview", () => {
  it("prefers message, then body (legacy reject alerts)", () => {
    expect(notificationPreview({ message: "사유: 누락", body: "누락" })).toBe("사유: 누락");
    expect(notificationPreview({ message: "", body: "위험상황, 개선대책 누락" })).toBe(
      "위험상황, 개선대책 누락",
    );
    expect(notificationPreview({ message: "  ", body: "  " })).toBe("");
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
});
