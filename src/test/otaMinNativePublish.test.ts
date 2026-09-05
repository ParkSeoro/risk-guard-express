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

describe("AAB CI auto-saves min_native_version", () => {
  it("publish-ota-release accepts a min-native-only bump without a zip", () => {
    expect(fn).toContain("X-OTA-Set-Min-Native-Only");
    expect(fn).toContain("min_native_only");
    expect(fn).toContain("missing_min_native");
    expect(fn).toContain("Keep the Play floor across OTA publishes");
  });

  it("AAB workflow posts JSON and fails the job if save fails", () => {
    expect(aab).toContain("X-OTA-Set-Min-Native-Only: 1");
    expect(aab).toContain("min_native_only");
    expect(aab).toContain("min_native_version");
    expect(aab).toContain("::error::min_native_version");
    expect(aab).toContain("exit 1");
    expect(aab).not.toContain("마스터가 설정 → 모바일 앱 릴리스에서 직접 넣으세요.");
  });
});
