import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  IOS_SHAREABLE_BUST_PARAM,
  IOS_SHAREABLE_RECOVER_COOLDOWN_MS,
  IOS_SHAREABLE_RECOVER_KEY,
  cacheBustedLocation,
  isIosWebWindow,
  isShareableRuntimeError,
  shouldRecoverIosShareable,
} from "@/lib/iosShareableGuard";

describe("iosShareableGuard", () => {
  const originalNav = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNav,
      configurable: true,
    });
  });

  it("detects the iPhone Safari Shareable ReferenceError", () => {
    expect(isShareableRuntimeError(new Error("Can't find variable: Shareable"))).toBe(true);
    expect(isShareableRuntimeError(new ReferenceError("Shareable is not defined"))).toBe(true);
    expect(isShareableRuntimeError(new Error("library insert failed"))).toBe(false);
  });

  it("treats iPhone UA as iOS web and not Android", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
      configurable: true,
    });
    expect(isIosWebWindow(window)).toBe(true);

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Mozilla/5.0 (Linux; Android 14)" },
      configurable: true,
    });
    expect(isIosWebWindow(window)).toBe(false);
  });

  it("recovers once then cools down", () => {
    expect(shouldRecoverIosShareable(0, 1_000)).toBe(true);
    expect(shouldRecoverIosShareable(1_000, 1_000 + IOS_SHAREABLE_RECOVER_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldRecoverIosShareable(1_000, 1_000 + IOS_SHAREABLE_RECOVER_COOLDOWN_MS)).toBe(true);
  });

  it("cache-busts the document URL so Safari does not reuse the broken JS", () => {
    expect(cacheBustedLocation("https://safenex.org/app?tab=home#x", 99))
      .toBe(`/app?tab=home&${IOS_SHAREABLE_BUST_PARAM}=99#x`);
    const guard = readFileSync("src/lib/iosShareableGuard.ts", "utf8");
    expect(guard).toContain("location.replace");
    expect(guard).toContain("cacheBustedLocation");
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(IOS_SHAREABLE_RECOVER_KEY);
    expect(html).toContain(IOS_SHAREABLE_BUST_PARAM);
    expect(html).toContain("Can't find variable");
    expect(html).toContain("location.replace");
  });
});
