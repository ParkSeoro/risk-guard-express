import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_DESKTOP_SETTINGS,
  loadDesktopSettings,
  saveDesktopSettings,
  loadManagerLoginMemory,
  saveManagerLoginMemory,
  loadDesktopPresence,
  saveDesktopPresence,
} from "@/lib/desktopBridge";
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

  it("routes admin post-consent login to /app/admin/desktop-workspace when enabled", () => {
    saveDesktopSettings({ launchMessengerWorkspaceOnLogin: false });
    expect(postConsentHomePath(["safety_manager"])).toBe("/app/admin");

    saveDesktopSettings({ launchMessengerWorkspaceOnLogin: true });
    expect(postConsentHomePath(["safety_manager"])).toBe("/app/admin/desktop-workspace");
  });
});
