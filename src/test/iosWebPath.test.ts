import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

describe("iosWebPath", () => {
  const originalNav = globalThis.navigator;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNav,
      configurable: true,
    });
    vi.unstubAllGlobals();
  });

  it("detects iPhone UA as iOS device", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
      configurable: true,
    });
    const { isIosDevice, isIosWebClient } = await import("@/lib/iosWebPath");
    expect(isIosDevice()).toBe(true);
    expect(isIosWebClient()).toBe(true);
  });

  it("does not treat Android as iOS", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Mozilla/5.0 (Linux; Android 14)" },
      configurable: true,
    });
    const { isIosDevice, isIosWebClient } = await import("@/lib/iosWebPath");
    expect(isIosDevice()).toBe(false);
    expect(isIosWebClient()).toBe(false);
  });
});
