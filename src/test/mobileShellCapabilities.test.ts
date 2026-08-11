import { describe, expect, it } from "vitest";
import {
  mobileTabsForBucket,
  resolveGlobalMobileRole,
  resolveMobileShellBucket,
  roleLabelKo,
} from "@/lib/mobileShell";
import { canMobileApprove, mobileCapabilities } from "@/lib/mobileCapabilities";
import { previewModeToRole } from "@/contexts/PreviewContext";

describe("mobile shell role buckets", () => {
  it("maps project roles to worker vs manager buckets", () => {
    expect(resolveMobileShellBucket("worker")).toBe("worker");
    expect(resolveMobileShellBucket("supervisor")).toBe("manager");
    expect(resolveMobileShellBucket("safety_manager")).toBe("manager");
    expect(resolveMobileShellBucket("master", true)).toBe("master");
  });

  it("keeps manager tabs when project unset via global role fallback", () => {
    expect(resolveGlobalMobileRole((r) => r === "site_manager")).toBe("site_manager");
    expect(resolveMobileShellBucket(resolveGlobalMobileRole((r) => r === "site_manager"))).toBe(
      "manager",
    );
    expect(resolveGlobalMobileRole(() => false)).toBe("viewer");
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
    expect(mobileTabsForBucket("manager").find((t) => t.key === "tasks")?.label).toBe("현장");
    expect(mobileTabsForBucket("worker").find((t) => t.key === "tasks")?.label).toBe("할 일");
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

  it("labels site_supervisor as 관리감독자 and supervisor as 감리 (SSOT)", () => {
    expect(roleLabelKo("site_supervisor")).toBe("관리감독자");
    expect(roleLabelKo("supervisor")).toBe("감리");
  });
});
