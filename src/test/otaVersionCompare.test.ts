import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANDROID_VERSION_CODE, APP_VERSION } from "@/lib/appVersion";
import { shouldOfferStoreUpdate, BOOT_STORE_CHECK_MS } from "@/lib/native/bootStoreGate";
import { cmpVersion } from "@/lib/native/otaUpdater";
import { isNewerScreenRelease } from "@/lib/otaVersion";

describe("cmpVersion — OTA 1.0.0-timestamp builds", () => {
  it("orders CI date-suffix versions", () => {
    expect(cmpVersion("1.0.0-202608040455", "1.0.0-202608040137")).toBeGreaterThan(0);
    expect(cmpVersion("1.0.0-202608040137", "1.0.0-202608040455")).toBeLessThan(0);
    expect(cmpVersion("1.0.0-202608040455", "1.0.0-202608040455")).toBe(0);
  });

  it("treats built-in / unknown as older than any release", () => {
    expect(cmpVersion("1.0.0-202608040455", "0.0.0")).toBeGreaterThan(0);
    expect(cmpVersion("1.0.0-202608040455", "내장")).toBeGreaterThan(0);
  });

  it("still handles plain semver", () => {
    expect(cmpVersion("1.0.1", "1.0.0")).toBeGreaterThan(0);
    expect(cmpVersion("1.1.0", "1.0.9")).toBeGreaterThan(0);
  });

  it("1.1.0 bridge is newer than stuck 1.0.0 clients (old + new compare)", () => {
    // Old broken compare: Number("1-ts")=NaN→0, so need minor bump 1.1 > 1.0
    const oldCmp = (a: string, b: string) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x !== y) return x - y;
      }
      return 0;
    };
    expect(oldCmp("1.1.0-202608040600", "1.0.0")).toBeGreaterThan(0);
    expect(oldCmp("1.0.1-202608040505", "1.0.0")).toBe(0); // still stuck
    expect(cmpVersion("1.1.0-202608040600", "1.0.0")).toBeGreaterThan(0);
  });

  it("does not let an older number with a timestamp replace a newer install", () => {
    expect(cmpVersion("1.1.5-202611050559", "1.1.5")).toBeGreaterThan(0);
    expect(cmpVersion("1.1.5-202611050559", "1.1.5-202611050541")).toBeGreaterThan(0);
    expect(cmpVersion("1.1.4-202611059999", "1.1.5")).toBeLessThan(0);
  });
});

describe("store app 1.2.0 and screen updates", () => {
  it("keeps package.json on the same phone version and the next Play code", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(APP_VERSION).toBe("1.2.0");
    expect(pkg.version).toBe(APP_VERSION);
    expect(pkg.androidVersionCode).toBe(ANDROID_VERSION_CODE);
    expect(ANDROID_VERSION_CODE).toBe(479);
  });

  it("does not replace a newer store app with an older screen bundle", () => {
    expect(isNewerScreenRelease("1.1.8-202611100454", "builtin", APP_VERSION)).toBe(false);
    expect(isNewerScreenRelease("1.1.8-202611100454", "내장", APP_VERSION)).toBe(false);
    expect(isNewerScreenRelease("1.2.0-202611100600", "builtin", APP_VERSION)).toBe(true);
    expect(isNewerScreenRelease("1.2.0-202611100600", "1.2.0-202611100500", APP_VERSION)).toBe(true);
    expect(isNewerScreenRelease("1.1.8-202611100454", "1.1.8-202611100500", APP_VERSION)).toBe(false);
  });

  it("shows the store screen only when the install is older and was not skipped today", () => {
    expect(shouldOfferStoreUpdate(false, false)).toBe(false);
    expect(shouldOfferStoreUpdate(true, true)).toBe(false);
    expect(shouldOfferStoreUpdate(true, false)).toBe(true);
    expect(BOOT_STORE_CHECK_MS).toBeLessThanOrEqual(5_000);
  });
});
