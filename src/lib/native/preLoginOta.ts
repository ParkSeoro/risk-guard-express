/**
 * 로그인 화면을 그리기 전에, 네이티브에서만 화면 묶음을 맞춘다.
 *
 * 예전 먹통 두 가지를 다시 열지 않는다.
 * 1. 시작 화면이 받기 완료를 끝없이 기다리면 WebView 타이머가 멈춰도 빠져나오지 못했다.
 *    지금은 버전 조회 5초, 받기 90초, 적용 10초가 지나면 로그인을 연다.
 *    제한 시간이 지난 뒤에는 set()을 호출하지 않아, 늦은 받기가 로그인 중에 화면을 갈아엎지 않는다.
 * 2. 받기와 로그인 요청이 겹치면 관리자·근로자 로그인이 "처리 중…"에서 멈췄다.
 *    지금은 App(로그인)을 올리기 전에 받기를 끝내거나 포기한다.
 *    로그인 처리(Auth.tsx, workerAuth.ts)에서는 받지 않는다.
 *
 * 조회는 인증 저장소를 쓰지 않는 anon 클라이언트만 사용한다.
 * 조회가 실패하거나 시간이 넘으면 업데이트가 없는 것으로 보고 로그인을 연다.
 * Play 스토어 강제 화면은 여기서 띄우지 않는다.
 */
import { isOtaUpdateAvailable } from "@/lib/otaVersion";
import { getOtaAnonClient } from "./otaAnonClient";
import { OTA_DOWNLOAD_TIMEOUT_MS } from "./otaUpdater";
import { isNativeApp } from "./platform";

export const PRE_LOGIN_OTA_MESSAGE = "업데이트 중";
export const PRE_LOGIN_VERSION_CHECK_MS = 5_000;
export const PRE_LOGIN_APPLY_MS = 10_000;
/** 받기 제한 시간이 지난 뒤, 앱 안 자동 받기가 같은 받기를 겹치지 않게 기다리는 시간. */
export const PRE_LOGIN_ABANDON_QUIET_MS = 120_000;

const SKIP_UNTIL_KEY = "safenex-prelogin-ota-skip-until";
const APPLIED_VERSION_KEY = "safenex-prelogin-ota-applied";

export type PreLoginRelease = {
  version: string;
  downloadUrl: string;
  checksum?: string;
};

/** 제한 시간이 지난 받기 결과로는 화면을 갈아엎지 않는다. */
export function shouldApplyDownloadedBundle(
  abandoned: boolean,
  bundleId: string | null | undefined,
): boolean {
  return abandoned === false && typeof bundleId === "string" && bundleId.length > 0;
}

export function markPreLoginDownloadAbandoned(now = Date.now()): void {
  try {
    sessionStorage.setItem(SKIP_UNTIL_KEY, String(now + PRE_LOGIN_ABANDON_QUIET_MS));
  } catch {
    /* private mode */
  }
}

/** 포기한 네이티브 받기가 아직 돌 수 있는 동안 앱 안 자동 받기를 건너뛴다. */
export function shouldSkipAutoOta(now: number): boolean {
  try {
    const until = Number(sessionStorage.getItem(SKIP_UNTIL_KEY) || 0);
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

function rememberAppliedVersion(version: string): void {
  try {
    sessionStorage.setItem(APPLIED_VERSION_KEY, version);
  } catch {
    /* ignore */
  }
}

function alreadyApplied(version: string): boolean {
  try {
    return sessionStorage.getItem(APPLIED_VERSION_KEY) === version;
  } catch {
    return false;
  }
}

function failAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}

function paintUpdating(): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <div data-prelogin-ota="1" style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc">
      <div style="text-align:center">
        <h1 style="font-size:22px;font-weight:600;margin:0 0 8px">${PRE_LOGIN_OTA_MESSAGE}</h1>
        <p style="margin:0;color:#cbd5e1">잠시만 기다려 주세요.</p>
      </div>
    </div>
  `;
}

function clearUpdating(): void {
  const root = document.getElementById("root");
  if (!root?.querySelector("[data-prelogin-ota]")) return;
  root.innerHTML = "";
}

async function findNewerRelease(): Promise<PreLoginRelease | null> {
  const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
  const current = await CapacitorUpdater.current();
  const currentVersion = String((current as { bundle?: { version?: string } })?.bundle?.version || "");
  const channel = localStorage.getItem("app-update-channel") === "beta" ? "beta" : "stable";
  const ota = getOtaAnonClient();
  const { data, error } = await ota.rpc("get_latest_app_release", {
    _channel: channel,
    _platform: "android",
  });
  if (error) return null;
  const release = (Array.isArray(data) ? data[0] : data) as {
    version?: string;
    bundle_url?: string;
    checksum?: string;
  } | null;
  const version = release?.version ? String(release.version) : "";
  if (!version || !release?.bundle_url) return null;
  if (alreadyApplied(version)) return null;
  if (!isOtaUpdateAvailable(version, currentVersion)) return null;

  let downloadUrl = String(release.bundle_url);
  if (downloadUrl.startsWith("storage:")) {
    const path = downloadUrl.replace(/^storage:/, "");
    const { data: signed, error: signError } = await ota.storage
      .from("app-updates")
      .createSignedUrl(path, 60 * 60);
    if (signError || !signed?.signedUrl) return null;
    downloadUrl = signed.signedUrl;
  }
  return {
    version,
    downloadUrl,
    checksum: release.checksum || undefined,
  };
}

/**
 * 새 화면이 있으면 로그인 전에 받고 적용한다.
 * 어떤 실패도 던지지 않는다. 호출자는 이 함수가 끝나면 로그인을 연다.
 * set()이 화면을 갈아엎으면 이 페이지는 사라지고, 새 묶음이 처음부터 다시 시작한다.
 */
export async function runPreLoginOta(): Promise<void> {
  if (!isNativeApp()) return;

  try {
    await runPreLoginOtaOnce();
  } catch (e) {
    clearUpdating();
    console.warn("[prelogin-ota] skipped", e);
  }
}

async function runPreLoginOtaOnce(): Promise<void> {
  let release: PreLoginRelease | null = null;
  try {
    release = await Promise.race([
      findNewerRelease(),
      failAfter(PRE_LOGIN_VERSION_CHECK_MS, "prelogin version check timeout"),
    ]);
  } catch (e) {
    console.warn("[prelogin-ota] version check skipped", e);
    return;
  }
  if (!release) return;

  paintUpdating();
  let abandoned = false;
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    const downloadPromise = CapacitorUpdater.download({
      url: release.downloadUrl,
      version: release.version,
      checksum: release.checksum,
    });
    const downloaded = await Promise.race([
      downloadPromise.then((bundle) => ({ timedOut: false as const, bundle })),
      new Promise<{ timedOut: true; bundle: null }>((resolve) => {
        window.setTimeout(() => {
          abandoned = true;
          resolve({ timedOut: true, bundle: null });
        }, OTA_DOWNLOAD_TIMEOUT_MS);
      }),
    ]);

    const bundleId = downloaded.bundle ? String(downloaded.bundle.id || "") : "";
    if (!shouldApplyDownloadedBundle(abandoned || downloaded.timedOut, bundleId)) {
      markPreLoginDownloadAbandoned();
      void downloadPromise.then(() => undefined, () => undefined);
      console.warn("[prelogin-ota] download skipped, opening login");
      return;
    }

    rememberAppliedVersion(release.version);
    try {
      await Promise.race([
        CapacitorUpdater.set({ id: bundleId }),
        failAfter(PRE_LOGIN_APPLY_MS, "prelogin apply timeout"),
      ]);
    } catch (e) {
      // 버전 기록은 남긴다. set()이 늦게 화면을 갈아엎어도 같은 받기를 반복하지 않는다.
      markPreLoginDownloadAbandoned();
      console.warn("[prelogin-ota] apply skipped", e);
    }
  } catch (e) {
    markPreLoginDownloadAbandoned();
    console.warn("[prelogin-ota] download skipped", e);
  } finally {
    clearUpdating();
  }
}
