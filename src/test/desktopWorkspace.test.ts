import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_DESKTOP_SETTINGS,
  loadDesktopSettings,
  saveDesktopSettings,
  loadManagerLoginMemory,
  saveManagerLoginMemory,
  loadDesktopPresence,
  saveDesktopPresence,
  resolveDesktopRouteWindowSize,
  setDesktopShellActive,
} from "@/lib/desktopBridge";
import { DESKTOP_RAIL_ITEMS } from "@/components/desktop/DesktopRailSidebar";
import { prefersMobileAppShell } from "@/hooks/use-mobile";
import { postConsentHomePath } from "@/components/AuthGuard";

describe("SafeNex Windows Desktop Bridge & KakaoTalk Workspace Settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("loads default desktop settings and persists updates", () => {
    const initial = loadDesktopSettings();
    expect(initial.autoStartOnBoot).toBe(true);
    expect(initial.keepLoggedIn).toBe(true);
    expect(initial.minimizeToTrayOnClose).toBe(true);
    expect(initial.defaultWindowMode).toBe(DEFAULT_DESKTOP_SETTINGS.defaultWindowMode);

    const updated = saveDesktopSettings({
      defaultWindowMode: "compact",
      alwaysOnTop: true,
      launchMessengerWorkspaceOnLogin: true,
    });
    expect(updated.defaultWindowMode).toBe("compact");
    expect(updated.alwaysOnTop).toBe(true);
    expect(updated.launchMessengerWorkspaceOnLogin).toBe(true);

    const reloaded = loadDesktopSettings();
    expect(reloaded.defaultWindowMode).toBe("compact");
    expect(reloaded.alwaysOnTop).toBe(true);
    expect(reloaded.launchMessengerWorkspaceOnLogin).toBe(true);
  });

  it("persists manager login email and auto-login preference", () => {
    saveManagerLoginMemory({
      email: "safety@safenex.kr",
      rememberEmail: true,
      autoLoginEnabled: true,
    });
    const mem = loadManagerLoginMemory();
    expect(mem.email).toBe("safety@safenex.kr");
    expect(mem.rememberEmail).toBe(true);
    expect(mem.autoLoginEnabled).toBe(true);

    saveManagerLoginMemory({
      email: "safety@safenex.kr",
      rememberEmail: false,
      autoLoginEnabled: false,
    });
    const cleared = loadManagerLoginMemory();
    expect(cleared.email).toBe("");
    expect(cleared.rememberEmail).toBe(false);
    expect(cleared.autoLoginEnabled).toBe(false);
  });

  it("persists desktop presence status", () => {
    expect(loadDesktopPresence()).toBe("online");
    saveDesktopPresence("inspecting");
    expect(loadDesktopPresence()).toBe("inspecting");
  });

  it("routes admin post-consent login to /app/admin/desktop-workspace only inside the Windows Desktop app", () => {
    delete window.safenexDesktop;
    saveDesktopSettings({ launchMessengerWorkspaceOnLogin: true });
    expect(postConsentHomePath(["safety_manager"])).toBe("/app/admin");

    window.safenexDesktop = { isDesktopApp: true };
    saveDesktopSettings({ launchMessengerWorkspaceOnLogin: true });
    expect(postConsentHomePath(["safety_manager"])).toBe("/app/admin/desktop-workspace");
    delete window.safenexDesktop;
  });

  it("never redirects narrow PC desktop shell windows to the mobile worker app", () => {
    Object.defineProperty(window, "innerWidth", { value: 420, configurable: true });
    setDesktopShellActive(true);
    expect(prefersMobileAppShell()).toBe(false);
    expect(postConsentHomePath(["safety_manager"])).not.toBe("/app/worker/today");
  });

  it("keeps rail menu labels clean without parentheses or pixel sizes and unifies work window sizes", () => {
    for (const item of DESKTOP_RAIL_ITEMS) {
      expect(item.label).not.toContain("(");
      expect(item.label).not.toContain(")");
      expect(item.label).not.toMatch(/\d+×\d+/);
    }
    expect(resolveDesktopRouteWindowSize("/app/admin/desktop-workspace")).toEqual({
      width: 420,
      height: 680,
      isMessengerView: true,
    });
    expect(resolveDesktopRouteWindowSize("/app/admin/alerts")).toEqual({
      width: 1260,
      height: 820,
      isMessengerView: false,
    });
    expect(resolveDesktopRouteWindowSize("/app/admin/announcements")).toEqual({
      width: 1260,
      height: 820,
      isMessengerView: false,
    });
    expect(resolveDesktopRouteWindowSize("/app/admin/work-permits")).toEqual({
      width: 1260,
      height: 820,
      isMessengerView: false,
    });
  });
});
