import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMessengerPickerActive,
  consumeMessengerPickerReturnPath,
  markMessengerPickerActive,
  messengerHomePath,
  messengerRoomPath,
  readMessengerPickerState,
} from "@/lib/messengerPath";
import { afterConsentHomePath } from "@/components/AuthGuard";

describe("messengerPath & mobile file picker recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("uses the worker shell on a phone and the admin shell on desktop", () => {
    expect(messengerHomePath({ mobileShell: true })).toBe("/app/worker/messenger");
    expect(messengerHomePath({ mobileShell: false })).toBe("/app/admin/messenger");
    expect(messengerRoomPath("room-42", { mobileShell: true })).toBe(
      "/app/worker/messenger?room=room-42",
    );
  });

  it("persists and consumes the active messenger room when returning from the OS file picker", () => {
    markMessengerPickerActive("room-alpha");
    expect(readMessengerPickerState()?.roomId).toBe("room-alpha");

    const restored = consumeMessengerPickerReturnPath({ mobileShell: true });
    expect(restored).toBe("/app/worker/messenger?room=room-alpha");
    expect(readMessengerPickerState()).toBeNull();
  });

  it("redirects afterConsentHomePath back to the active messenger room instead of /app/worker/today", () => {
    markMessengerPickerActive("room-beta");
    const dest = afterConsentHomePath(
      ["project_admin"],
      {
        agreed_to_terms: true,
        agreed_to_privacy: true,
        agreed_to_admin_security: true,
        consent_agreed_at: "2026-11-10T00:00:00Z",
        ui_locale_chosen: true,
      },
      { rolesReady: true },
    );
    expect(dest).toContain("/messenger?room=room-beta");
    clearMessengerPickerActive();
  });
});
