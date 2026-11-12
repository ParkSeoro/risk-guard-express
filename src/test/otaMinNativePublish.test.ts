import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fn = readFileSync(
  resolve(process.cwd(), "supabase/functions/publish-ota-release/index.ts"),
  "utf8",
);
const aab = readFileSync(
  resolve(process.cwd(), ".github/workflows/android-aab.yml"),
  "utf8",
);

describe("Play floor is not raised by an AAB artifact", () => {
  it("publish-ota-release accepts a min-native-only bump without a zip", () => {
    expect(fn).toContain("X-OTA-Set-Min-Native-Only");
    expect(fn).toContain("min_native_only");
    expect(fn).toContain("missing_min_native");
    expect(fn).toContain("Keep the Play floor across OTA publishes");
    expect(fn).toContain("X-OTA-Platform");
    expect(fn).toContain("min_native_desktop");
    expect(fn).toContain("desktop rows keep min_native_version empty");
    expect(fn).toContain('platform === "android"');
  });

  it("AAB workflow does not raise min_native_version from an artifact", () => {
    expect(aab).not.toContain("X-OTA-Set-Min-Native-Only");
    expect(aab).not.toContain("min_native_only");
    expect(aab).toContain("app_releases.min_native_version 은 올리지 않는다.");
    expect(aab).not.toContain("secrets.ANDROID_VERSION_NAME");
  });
});
