import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkPermissions = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: {
    checkPermissions: () => checkPermissions(),
  },
}));

import {
  clearNativePermissionsDone,
  hasCompletedNativePermissions,
  markNativePermissionsDone,
  syncNativePermissionsFlagWithOs,
} from "@/lib/native/isNativeApp";

describe("native permissions completion flag", () => {
  beforeEach(() => {
    clearNativePermissionsDone();
    checkPermissions.mockReset();
  });

  afterEach(() => {
    clearNativePermissionsDone();
  });

  it("marks and clears the v2 done flag", () => {
    expect(hasCompletedNativePermissions()).toBe(false);
    markNativePermissionsDone();
    expect(hasCompletedNativePermissions()).toBe(true);
    clearNativePermissionsDone();
    expect(hasCompletedNativePermissions()).toBe(false);
  });

  it("clears done when OS location is no longer granted", async () => {
    markNativePermissionsDone();
    checkPermissions.mockResolvedValue({ location: "denied" });
    const done = await syncNativePermissionsFlagWithOs();
    expect(done).toBe(false);
    expect(hasCompletedNativePermissions()).toBe(false);
  });

  it("keeps done when OS location is granted", async () => {
    markNativePermissionsDone();
    checkPermissions.mockResolvedValue({ location: "granted" });
    const done = await syncNativePermissionsFlagWithOs();
    expect(done).toBe(true);
    expect(hasCompletedNativePermissions()).toBe(true);
  });
});
