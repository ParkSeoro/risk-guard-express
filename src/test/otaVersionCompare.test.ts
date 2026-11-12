import { describe, expect, it } from "vitest";
import { APP_VERSION, ANDROID_VERSION_CODE } from "@/lib/appVersion";
import { isNewerScreenRelease } from "@/lib/otaVersion";
import { cmpVersion } from "@/lib/native/otaUpdater";
import { readFileSync } from "node:fs";

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

  it("keeps package.json and the baked phone version on 1.1.9 / 479", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
      androidVersionCode: number;
    };
    expect(APP_VERSION).toBe("1.1.9");
    expect(ANDROID_VERSION_CODE).toBe(479);
    expect(pkg.version).toBe(APP_VERSION);
    expect(pkg.androidVersionCode).toBe(ANDROID_VERSION_CODE);
  });

  it("does not replace a 1.1.9 install with the older 1.1.8 screen", () => {
    expect(isNewerScreenRelease("1.1.8-202611112336", "builtin", APP_VERSION)).toBe(false);
    expect(isNewerScreenRelease("1.1.8-202611112336", "내장", APP_VERSION)).toBe(false);
    expect(isNewerScreenRelease("1.1.8-202611112336", "0.0.0", APP_VERSION)).toBe(false);
    expect(isNewerScreenRelease("1.1.9-202611120930", "builtin", APP_VERSION)).toBe(true);
    expect(isNewerScreenRelease("1.1.9-202611120930", "1.1.9", APP_VERSION)).toBe(true);
  });

  it("does not let an older number with a timestamp replace a newer install", () => {
    expect(cmpVersion("1.1.5-202611050559", "1.1.5")).toBeGreaterThan(0);
    expect(cmpVersion("1.1.5-202611050559", "1.1.5-202611050541")).toBeGreaterThan(0);
    expect(cmpVersion("1.1.4-202611059999", "1.1.5")).toBeLessThan(0);
  });
});
