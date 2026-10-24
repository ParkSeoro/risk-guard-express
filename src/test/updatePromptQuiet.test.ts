import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAutoCheckThrottled, MIN_CHECK_INTERVAL_MS } from "@/lib/native/otaUpdater";

function src(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("isAutoCheckThrottled", () => {
  it("lets the first check run when lastCheckAt is still 0", () => {
    expect(isAutoCheckThrottled(Date.now(), 0)).toBe(false);
    expect(isAutoCheckThrottled(1_000, 0)).toBe(false);
  });

  it("skips a second check inside the quiet window", () => {
    const last = 1_700_000_000_000;
    expect(isAutoCheckThrottled(last + MIN_CHECK_INTERVAL_MS - 1, last)).toBe(true);
    expect(isAutoCheckThrottled(last + MIN_CHECK_INTERVAL_MS, last)).toBe(false);
  });
});

describe("update prompts stay off the launch path", () => {
  it("does not paint the store splash during boot", () => {
    const main = src("src/main.tsx");
    expect(main).not.toContain("runBootStoreGate");
  });

  it("does not mount the blocking store dialog", () => {
    const app = src("src/App.tsx");
    expect(app).not.toContain("NativeStoreUpdateGate");
  });

  it("shows version numbers on 더보기 without update actions", () => {
    const card = src("src/components/mobile/MobileOtaUpdateCard.tsx");
    expect(card).not.toContain("openPlayStore");
    expect(card).not.toContain("checkAndDownloadOta");
    expect(card).toContain("스토어 앱 (AAB)");
    expect(card).toContain("화면 (OTA)");
  });

  it("does not stamp lastCheckAt before the first OTA check", () => {
    const ota = src("src/lib/native/otaUpdater.ts");
    expect(ota).not.toContain("lastCheckAt = Date.now()");
    expect(ota).toContain("isAutoCheckThrottled(now, lastCheckAt)");
  });
});

describe("AAB build keeps Play release notes", () => {
  it("uploads the Korean notes next to the AAB", () => {
    const aab = src(".github/workflows/android-aab.yml");
    expect(aab).toContain("android/play-release-notes-ko.txt");
    expect(aab).toContain("safenex-play-release-notes-");
    expect(aab).toContain("if-no-files-found: error");
  });

  it("describes the changed and added behavior", () => {
    const notes = src("android/play-release-notes-ko.txt");
    expect(notes).toContain("변경");
    expect(notes).toContain("배터리 제한 없음 요청을 설정 검색에서 허용 버튼으로 바꿨습니다.");
    expect(notes).toContain("추가");
    expect(notes).toContain("허용 창이 뜨지 않는 이전 설치본에 나중에 버튼을 넣었습니다.");
    expect(notes).not.toContain("할 수 있습니다");
    expect(notes).not.toContain("있습니다");
  });
});
