import { beforeEach, describe, expect, it } from "vitest";
import { getMobileTiles } from "@/lib/mobileMenuPrefs";
import { resolveMobileWorkersTab } from "@/lib/mobileWorkers";

describe("resolveMobileWorkersTab", () => {
  it("lets managers open attendance and signature tabs", () => {
    expect(resolveMobileWorkersTab("attendance", true)).toBe("attendance");
    expect(resolveMobileWorkersTab("signatures", true)).toBe("signatures");
    expect(resolveMobileWorkersTab("signatures", false)).toBe("roster");
  });
});

describe("manager mobile tiles", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("includes attendance and signatures for managers, not field workers", () => {
    expect(getMobileTiles("supervisor")).toEqual(
      expect.arrayContaining(["attendance", "signatures"]),
    );
    expect(getMobileTiles("safety")).toEqual(expect.arrayContaining(["attendance", "signatures"]));
    expect(getMobileTiles("worker")).not.toEqual(expect.arrayContaining(["signatures"]));
    expect(getMobileTiles("worker")).not.toEqual(expect.arrayContaining(["attendance"]));
  });
});
