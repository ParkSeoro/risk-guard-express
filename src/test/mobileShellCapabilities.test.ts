import { describe, expect, it } from "vitest";
import { mobileTabsForBucket, resolveMobileShellBucket } from "@/lib/mobileShell";
import { canMobileApprove, mobileCapabilities } from "@/lib/mobileCapabilities";
import { previewModeToRole } from "@/contexts/PreviewContext";

describe("mobile shell role buckets", () => {
  it("maps project roles to worker vs manager buckets", () => {
    expect(resolveMobileShellBucket("worker")).toBe("worker");
    expect(resolveMobileShellBucket("supervisor")).toBe("manager");
    expect(resolveMobileShellBucket("safety_manager")).toBe("manager");
    expect(resolveMobileShellBucket("master", true)).toBe("master");
  });

  it("gives managers approvals + alerts inbox; workers get alerts not approvals", () => {
    const workerTabs = mobileTabsForBucket("worker").map((t) => t.key);
    const managerTabs = mobileTabsForBucket("manager").map((t) => t.key);
    const masterTabs = mobileTabsForBucket("master").map((t) => t.key);
    expect(workerTabs).not.toContain("approvals");
    expect(managerTabs).toContain("approvals");
    expect(workerTabs).toContain("alerts");
    expect(managerTabs).toContain("alerts");
    expect(masterTabs).toContain("alerts");
    expect(workerTabs).toContain("today");
    expect(managerTabs).toContain("today");
  });

  it("approval capability follows manager bucket", () => {
    expect(canMobileApprove("worker")).toBe(false);
    expect(canMobileApprove("site_manager")).toBe(true);
    expect(mobileCapabilities("worker").has("check_in")).toBe(true);
    expect(mobileCapabilities("safety_manager").has("suspend_workers")).toBe(true);
  });

  it("preview modes map to mobile roles", () => {
    expect(previewModeToRole("project_admin")).toBe("project_admin");
    expect(previewModeToRole("site_supervisor")).toBe("site_supervisor");
    expect(previewModeToRole("worker")).toBe("worker");
  });
});
