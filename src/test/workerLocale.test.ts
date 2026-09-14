import { describe, expect, it } from "vitest";
import { needsWorkerLocaleChoice, parseWorkerLocale, WORKER_LANGUAGE_PATH } from "@/lib/i18n/workerLocale";
import { afterConsentHomePath, WORKER_HOME } from "@/components/AuthGuard";
import { workerT } from "@/lib/i18n/workerStrings";
import { displayPledge } from "@/lib/i18n/pledges";
import { WORK_ACK_PLEDGE } from "@/lib/legal/dailyPledges";

describe("worker locale", () => {
  it("parses known locales and defaults to ko", () => {
    expect(parseWorkerLocale("en")).toBe("en");
    expect(parseWorkerLocale("ZH")).toBe("zh");
    expect(parseWorkerLocale("nope")).toBe("ko");
  });

  it("keeps Korean chrome and changes English", () => {
    expect(workerT("ko", "checkIn")).toBe("출근하기");
    expect(workerT("en", "checkIn")).toBe("Check in");
  });

  it("does not gate existing Korean accounts or missing column", () => {
    expect(needsWorkerLocaleChoice(null)).toBe(false);
    expect(needsWorkerLocaleChoice({ ui_locale_chosen: true })).toBe(false);
    expect(needsWorkerLocaleChoice({ ui_locale_chosen: null })).toBe(false);
    expect(needsWorkerLocaleChoice({ ui_locale_chosen: false })).toBe(true);
  });

  it("sends unchosen workers to the language screen, not today", () => {
    expect(afterConsentHomePath(["worker"], { ui_locale_chosen: false })).toBe(WORKER_LANGUAGE_PATH);
    expect(afterConsentHomePath(["worker"], { ui_locale_chosen: true })).toBe(WORKER_HOME);
  });

  it("shows translated pledges but Korean legal source stays", () => {
    expect(displayPledge("work", "ko")).toBe(WORK_ACK_PLEDGE);
    expect(displayPledge("work", "en")).not.toBe(WORK_ACK_PLEDGE);
    expect(displayPledge("work", "en").length).toBeGreaterThan(20);
  });
});
