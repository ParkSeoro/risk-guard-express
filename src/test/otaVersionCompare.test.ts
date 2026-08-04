import { describe, expect, it } from "vitest";
import { cmpVersion } from "@/lib/native/otaUpdater";

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
});
