import { describe, expect, it } from "vitest";
import {
  ADMIN_APPROVALS_PATH,
  approvalsBackOr,
  canInlineApprovalPreview,
  desktopApprovalEntityPath,
  desktopApprovalEntityPathFromInbox,
  resolveAdminApprovalsReturnPath,
} from "@/lib/approvalInboxPreview";

describe("approval inbox preview paths", () => {
  it("builds desktop entity paths", () => {
    expect(desktopApprovalEntityPath("work_permit", "p1")).toBe("/work-permits/p1");
    expect(desktopApprovalEntityPath("work_plan", "w1")).toBe("/work-plan/w1");
    expect(desktopApprovalEntityPath("assessment_run", "r1")).toBe("/assessment-run/r1");
  });

  it("appends from=approvals for full-screen escape", () => {
    expect(desktopApprovalEntityPathFromInbox("work_permit", "p1")).toBe(
      "/work-permits/p1?from=approvals",
    );
    expect(desktopApprovalEntityPathFromInbox("assessment_run_feedback", "r1")).toBe(
      "/assessment-run/r1?tab=feedback&from=approvals",
    );
  });

  it("resolves 목록 back to admin approvals", () => {
    expect(resolveAdminApprovalsReturnPath("approvals")).toBe(ADMIN_APPROVALS_PATH);
    expect(approvalsBackOr("/work-permits", "approvals")).toBe(ADMIN_APPROVALS_PATH);
    expect(approvalsBackOr("/work-permits", null)).toBe("/work-permits");
  });

  it("marks RA / plan / permit as inline-previewable", () => {
    expect(canInlineApprovalPreview("work_permit")).toBe(true);
    expect(canInlineApprovalPreview("work_plan")).toBe(true);
    expect(canInlineApprovalPreview("assessment_run")).toBe(true);
    expect(canInlineApprovalPreview("tbm")).toBe(false);
  });
});
