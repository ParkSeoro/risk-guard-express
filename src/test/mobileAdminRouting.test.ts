import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  postConsentHomePath,
  MOBILE_ADMIN_HOME,
  WORKER_HOME,
  DESKTOP_ADMIN_HOME,
} from "@/components/AuthGuard";

describe("postConsentHomePath — mobile admin routing", () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    localStorage.clear();
  });

  function setWidth(w: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
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

  it("keeps managers on /app/admin on desktop width", () => {
    setWidth(1200);
    expect(postConsentHomePath(["project_admin"])).toBe(DESKTOP_ADMIN_HOME);
    expect(postConsentHomePath(["master"])).toBe(DESKTOP_ADMIN_HOME);
  });

  it("forceDesktopUI keeps managers on /app/admin even on phone", () => {
    setWidth(390);
    localStorage.setItem("forceDesktopUI", "1");
    expect(postConsentHomePath(["project_admin"])).toBe(DESKTOP_ADMIN_HOME);
  });
});
