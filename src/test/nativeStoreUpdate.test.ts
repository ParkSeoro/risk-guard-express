import { describe, expect, it } from "vitest";
import { nativeNeedsStoreUpdate } from "@/lib/native/nativeStoreUpdate";

describe("nativeNeedsStoreUpdate", () => {
  it("does nothing when min is empty", () => {
    expect(nativeNeedsStoreUpdate({ version: "1.0.0", build: "100" }, null)).toBe(false);
    expect(nativeNeedsStoreUpdate({ version: "1.0.0", build: "100" }, "")).toBe(false);
  });

  it("compares versionName semver", () => {
    expect(nativeNeedsStoreUpdate({ version: "1.0.0", build: "100" }, "1.1.0")).toBe(true);
    expect(nativeNeedsStoreUpdate({ version: "1.1.0", build: "100" }, "1.1.0")).toBe(false);
    expect(nativeNeedsStoreUpdate({ version: "1.2.0", build: "100" }, "1.1.0")).toBe(false);
  });

  it("compares Play versionCode when min is an integer", () => {
    expect(nativeNeedsStoreUpdate({ version: "1.1.0", build: "458" }, "470")).toBe(true);
    expect(nativeNeedsStoreUpdate({ version: "1.1.0", build: "470" }, "470")).toBe(false);
    expect(nativeNeedsStoreUpdate({ version: "1.1.0", build: "480" }, "470")).toBe(false);
  });
});
