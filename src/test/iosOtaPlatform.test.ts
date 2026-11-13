import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  minNativeForOtaRow,
  nativeOtaLookupPlatform,
  otaPublishPlatforms,
  shouldOfferNativeStoreUpdate,
} from "@/lib/otaReleasePlatform";

function src(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("iPhone OTA stays off the Play floor", () => {
  it("publishes one zip to android, desktop, and ios", () => {
    expect(otaPublishPlatforms("")).toEqual(["android", "desktop", "ios"]);
    expect(otaPublishPlatforms("both")).toEqual(["android", "desktop", "ios"]);
    expect(otaPublishPlatforms("android")).toEqual(["android"]);
    expect(otaPublishPlatforms("ios")).toEqual(["ios"]);
    expect(otaPublishPlatforms("phone")).toBeNull();
  });

  it("stores the Play versionCode on the android row only", () => {
    expect(minNativeForOtaRow("android", "478")).toBe("478");
    expect(minNativeForOtaRow("ios", "478")).toBeNull();
    expect(minNativeForOtaRow("desktop", "478")).toBeNull();
  });

  it("asks for the shell platform and does not guess android", () => {
    expect(nativeOtaLookupPlatform("android")).toBe("android");
    expect(nativeOtaLookupPlatform("ios")).toBe("ios");
    expect(nativeOtaLookupPlatform("web")).toBeNull();
  });

  it("does not block an iPhone when the App Store URL is still empty", () => {
    expect(shouldOfferNativeStoreUpdate("android", true, false, "")).toBe(true);
    expect(shouldOfferNativeStoreUpdate("ios", true, false, "")).toBe(false);
    expect(shouldOfferNativeStoreUpdate("ios", true, false, "https://apps.apple.com/app/id1")).toBe(true);
    expect(shouldOfferNativeStoreUpdate("ios", true, true, "https://apps.apple.com/app/id1")).toBe(false);
    expect(shouldOfferNativeStoreUpdate("ios", false, false, "https://apps.apple.com/app/id1")).toBe(false);
  });

  it("keeps the lookup and the publisher from mixing the rows", () => {
    const sql = src("supabase/migrations/20261113153000_app_releases_ios_platform.sql");
    const publisher = src("supabase/functions/publish-ota-release/index.ts");
    const phone = src("src/lib/native/otaUpdater.ts");
    const pre = src("src/lib/native/preLoginOta.ts");
    expect(sql).toContain("q.platform = 'ios' AND r.platform IN ('ios', 'shared')");
    expect(sql).toContain("q.platform = 'android' AND r.platform IN ('android', 'shared')");
    expect(sql).toContain("min_native_version");
    expect(sql).toContain("NULL");
    expect(publisher).toContain('error: "min_native_ios"');
    expect(publisher).toContain('error: "min_native_desktop"');
    expect(publisher).toContain('platform === "android" ? resolvedMin : null');
    expect(phone).toContain("nativeOtaLookupPlatform");
    expect(phone).not.toContain('_platform: "android"');
    expect(pre).toContain("nativeOtaLookupPlatform");
    expect(pre).not.toContain('_platform: "android"');
  });
});
