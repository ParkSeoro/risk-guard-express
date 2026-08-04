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
});
