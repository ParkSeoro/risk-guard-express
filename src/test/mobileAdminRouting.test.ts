import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  postConsentHomePath,
  MOBILE_ADMIN_HOME,
  WORKER_HOME,
  DESKTOP_ADMIN_HOME,
} from "@/components/AuthGuard";
import { prefersMobileAppShell, setForceDesktop } from "@/hooks/use-mobile";
import {
  canonicalizeAppPath,
  resolveNotificationRoute,
  toMobileShellPath,
} from "@/lib/notificationRoutes";
import { resolveMobileHomePath, mobileEntityPath, mobileDocumentPath } from "@/lib/mobileNav";

describe("postConsentHomePath — mobile admin routing", () => {
  const originalInnerWidth = window.innerWidth;
  const originalUA = navigator.userAgent;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: originalUA,
    });
    localStorage.clear();
  });

  function setWidth(w: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  }

  function setPhoneUA() {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
  }

  it("sends pure workers to worker home on any viewport", () => {
    setWidth(390);
    expect(postConsentHomePath(["worker"])).toBe(WORKER_HOME);
    setWidth(1200);
    expect(postConsentHomePath(["worker"])).toBe(WORKER_HOME);
  });

  it("sends project_admin to mobile menu on phone (roles unchanged path only)", () => {
    setWidth(390);
    expect(postConsentHomePath(["project_admin"])).toBe(MOBILE_ADMIN_HOME);
    expect(postConsentHomePath(["master"])).toBe(MOBILE_ADMIN_HOME);
    expect(postConsentHomePath(["site_supervisor"])).toBe(MOBILE_ADMIN_HOME);
  });

  it("keeps managers on /app/admin on desktop width + desktop UA", () => {
    setWidth(1200);
    expect(postConsentHomePath(["project_admin"])).toBe(DESKTOP_ADMIN_HOME);
    expect(postConsentHomePath(["master"])).toBe(DESKTOP_ADMIN_HOME);
  });

  it("forceDesktopUI keeps managers on /app/admin even on phone", () => {
    setWidth(390);
    localStorage.setItem("forceDesktopUI", "1");
    expect(postConsentHomePath(["project_admin"])).toBe(DESKTOP_ADMIN_HOME);
  });

  it("phone UA keeps mobile shell even when landscape width ≥ 768", () => {
    setPhoneUA();
    setWidth(900);
    expect(prefersMobileAppShell()).toBe(true);
    expect(postConsentHomePath(["project_admin"])).toBe(MOBILE_ADMIN_HOME);
  });
});

describe("notification + entity mobile routes", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  });

  it("resolveNotificationRoute uses worker paths on mobile shell", () => {
    expect(resolveNotificationRoute({ related_type: "approval" }, { mobileShell: true })).toBe(
      "/app/worker/approvals",
    );
    expect(
      resolveNotificationRoute(
        { related_type: "assessment_run", related_id: "abc" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/risk-assessment/abc");
    expect(resolveNotificationRoute({ type: "approval_result" }, { mobileShell: true })).toBe(
      "/app/worker/approvals",
    );
  });

  it("canonicalizeAppPath remaps bare admin paths on mobile", () => {
    expect(canonicalizeAppPath("/approvals", { mobileShell: true })).toBe("/app/worker/approvals");
    expect(canonicalizeAppPath("/m", { mobileShell: true })).toBe("/app/worker/today");
    expect(canonicalizeAppPath("/m/inspect", { mobileShell: true })).toBe("/app/worker/inspect");
    expect(canonicalizeAppPath("/worker-distribution", { mobileShell: true })).toBe(
      "/app/worker/distribution",
    );
  });

  it("toMobileShellPath maps assessment and work plan deep links", () => {
    expect(toMobileShellPath("/app/admin/assessment-run/x1")).toBe("/app/worker/risk-assessment/x1");
    expect(toMobileShellPath("/app/admin/work-plan/p1")).toBe("/app/worker/work-plans/p1");
  });

  it("toMobileShellPath maps zone-events and settings to worker pages", () => {
    expect(toMobileShellPath("/app/admin/zone-events")).toBe("/app/worker/alerts");
    expect(toMobileShellPath("/app/admin/settings/account")).toBe("/app/worker/account");
  });

  it("announcement notifications open announcements list on phone and admin list on desktop", () => {
    expect(
      resolveNotificationRoute(
        { type: "announcement", related_type: "announcement", related_id: "n1" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/announcements?id=n1");
    expect(
      resolveNotificationRoute(
        { type: "announcement", related_id: "n1" },
        { mobileShell: false },
      ),
    ).toBe("/app/admin/announcements?id=n1");
  });

  it("danger_zone_entry notifications open worker alerts", () => {
    expect(
      resolveNotificationRoute({ type: "danger_zone_entry" }, { mobileShell: true }),
    ).toBe("/app/worker/alerts");
    expect(
      resolveNotificationRoute(
        { link: "/zone-events?project=p1" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/alerts");
  });

  it("resolveMobileHomePath is role-aware", () => {
    expect(resolveMobileHomePath(["project_admin"])).toBe(MOBILE_ADMIN_HOME);
    expect(resolveMobileHomePath(["worker"])).toBe(WORKER_HOME);
  });

  it("mobileEntityPath stays in worker shell", () => {
    // Permit document deep-link; approvals inbox remains the action surface
    expect(mobileEntityPath("work_permit", "p1").path).toBe("/app/worker/permits?id=p1");
    expect(mobileEntityPath("work_permit").path).toBe("/app/worker/permits");
    expect(mobileEntityPath("assessment_run", "r1").path).toBe("/app/worker/risk-assessment/r1");
  });

  it("mobileDocumentPath keeps 문서 보기 on permits with inbox return", () => {
    expect(mobileDocumentPath("work_permit", "p1", "approvals")).toBe(
      "/app/worker/permits?id=p1&from=approvals",
    );
    expect(mobileDocumentPath("assessment_run", "r1")).toBe("/app/worker/risk-assessment/r1");
    expect(mobileDocumentPath("assessment_run", "r1", "approvals")).toBe(
      "/app/worker/risk-assessment/r1?from=approvals",
    );
    expect(mobileDocumentPath("work_plan", "w1", "approvals")).toBe(
      "/app/worker/work-plans/w1?from=approvals",
    );
  });

  it("toMobileShellPath keeps work-permit document ids", () => {
    expect(toMobileShellPath("/app/admin/work-permits/p1")).toBe("/app/worker/permits?id=p1");
    expect(toMobileShellPath("/app/admin/work-permits")).toBe("/app/worker/permits");
  });

  it("mobile work_permit notifications open approvals inbox", () => {
    expect(
      resolveNotificationRoute({ type: "work_permit" }, { mobileShell: true }),
    ).toBe("/app/worker/approvals");
    expect(
      resolveNotificationRoute(
        { related_type: "work_permit", related_id: "x" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/approvals");
  });

  it("safety inspection notifications open the source document, not a blank create form", () => {
    expect(
      resolveNotificationRoute(
        { type: "inspection_fail", related_type: "safety_inspection", related_id: "ins-1" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/inspect?id=ins-1");
    expect(
      resolveNotificationRoute(
        { type: "inspection_fail", related_type: "safety_inspection", related_id: "ins-1" },
        { mobileShell: false },
      ),
    ).toBe("/app/admin/safety-inspections?id=ins-1");
    expect(toMobileShellPath("/app/admin/safety-inspections?id=ins-1")).toBe(
      "/app/worker/inspect?id=ins-1",
    );
    expect(mobileEntityPath("safety_inspection", "ins-1").path).toBe("/app/worker/inspect?id=ins-1");
  });

  it("setForceDesktop(false) clears sticky desktop", () => {
    setForceDesktop(true);
    expect(prefersMobileAppShell()).toBe(false);
    setForceDesktop(false);
    expect(prefersMobileAppShell()).toBe(true);
  });
});
