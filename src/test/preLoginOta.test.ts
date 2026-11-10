import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OTA_DOWNLOAD_TIMEOUT_MS } from "@/lib/native/otaUpdater";
import {
  PRE_LOGIN_ABANDON_QUIET_MS,
  PRE_LOGIN_APPLY_MS,
  PRE_LOGIN_OTA_MESSAGE,
  PRE_LOGIN_VERSION_CHECK_MS,
  markPreLoginDownloadAbandoned,
  shouldApplyDownloadedBundle,
  shouldSkipAutoOta,
} from "@/lib/native/preLoginOta";

function src(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("pre-login update wording and deadlines", () => {
  it("shows 업데이트 중 and gives up instead of waiting forever", () => {
    expect(PRE_LOGIN_OTA_MESSAGE).toBe("업데이트 중");
    expect(PRE_LOGIN_VERSION_CHECK_MS).toBeLessThanOrEqual(5_000);
    expect(OTA_DOWNLOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(PRE_LOGIN_APPLY_MS).toBeLessThanOrEqual(10_000);
    expect(PRE_LOGIN_ABANDON_QUIET_MS).toBeGreaterThanOrEqual(OTA_DOWNLOAD_TIMEOUT_MS);
  });

  it("does not apply a bundle after the download deadline", () => {
    expect(shouldApplyDownloadedBundle(true, "bundle-1")).toBe(false);
    expect(shouldApplyDownloadedBundle(false, "")).toBe(false);
    expect(shouldApplyDownloadedBundle(false, null)).toBe(false);
    expect(shouldApplyDownloadedBundle(false, "bundle-1")).toBe(true);
  });

  it("keeps the in-app check from starting a second download while the first may still be running", () => {
    const now = 1_700_000_000_000;
    markPreLoginDownloadAbandoned(now);
    expect(shouldSkipAutoOta(now + 1_000)).toBe(true);
    expect(shouldSkipAutoOta(now + PRE_LOGIN_ABANDON_QUIET_MS)).toBe(false);
  });
});

describe("pre-login update stays off the login handlers", () => {
  const pre = src("src/lib/native/preLoginOta.ts");

  afterEach(() => {
    sessionStorage.clear();
  });

  it("checks the version with the anon client and only then downloads", () => {
    expect(pre).toContain('PRE_LOGIN_OTA_MESSAGE = "업데이트 중"');
    expect(pre).not.toContain("화면을 받는");
    expect(pre).not.toContain("받는 중");
    expect(pre).toContain("getOtaAnonClient");
    expect(pre).not.toContain("@/integrations/supabase/client");
    expect(pre).not.toContain("getSession");
    expect(pre).not.toContain("runBootStoreGate");
    const once = pre.slice(pre.indexOf("async function runPreLoginOtaOnce"));
    expect(once.indexOf("findNewerRelease()")).toBeLessThan(once.indexOf("paintUpdating()"));
    expect(once.indexOf("shouldApplyDownloadedBundle")).toBeLessThan(once.indexOf("CapacitorUpdater.set"));
    expect(pre).toContain("markPreLoginDownloadAbandoned");
  });

  it("does not download from the login screen or the ready handshake", () => {
    const auth = src("src/pages/Auth.tsx");
    const worker = src("src/lib/workerAuth.ts");
    const boot = src("src/lib/native/bootOtaGate.ts");
    expect(auth).not.toContain("runPreLoginOta");
    expect(auth).not.toContain("CapacitorUpdater");
    expect(worker).not.toContain("runPreLoginOta");
    expect(worker).not.toContain("CapacitorUpdater");
    const bootBody = boot.slice(boot.indexOf("export async function runBootOtaGate"));
    expect(bootBody).not.toContain(".download(");
    expect(bootBody).not.toContain(".set(");
    expect(bootBody).not.toContain("runPreLoginOta");
  });
});
