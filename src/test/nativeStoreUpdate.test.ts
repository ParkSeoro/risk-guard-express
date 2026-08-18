import { describe, expect, it } from "vitest";
import { formatNativeVersionLabel, nativeNeedsStoreUpdate } from "@/lib/native/nativeStoreUpdate";

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

describe("formatNativeVersionLabel", () => {
  it("shows versionName and versionCode for AAB identity", () => {
    expect(formatNativeVersionLabel({ version: "1.1.1", build: "470" })).toBe("1.1.1 (470)");
  });

  it("omits a missing build", () => {
    expect(formatNativeVersionLabel({ version: "1.1.1", build: "0" })).toBe("1.1.1");
    expect(formatNativeVersionLabel(null)).toBe("확인 불가");
  });
});
