// OTA 자동 업데이트 (Capgo Capacitor Updater + Supabase Storage)
// - 네이티브만. 웹/프리뷰는 no-op.
// - 로그인·가입 화면에서는 받지 않는다. 다운로드가 로그인 요청과 겹치면
//   관리자 signInWithPassword / 근로자 전화 로그인이 "처리 중…"에서 멈춘다.
// - 로그인 화면을 그리기 전 받기는 preLoginOta.ts 가 맡는다. 여기서는 앱 안에서만 받는다.
// - 앱(/app)에 들어온 뒤에만 받고, 화면은 그대로 둔다.
// - 앱을 벗어날 때 받은 묶음으로 바꾼다. 다음에 열면 새 화면이다.
// - Release lookup uses otaAnonClient (no auth Preferences) so boot splash cannot hang.
import { supabase } from "@/integrations/supabase/client";
import { cmpOtaVersion } from "@/lib/otaVersion";
import { getOtaAnonClient } from "./otaAnonClient";
import { isNativeApp } from "./platform";

const CHANNEL_KEY = "app-update-channel";
export const MIN_CHECK_INTERVAL_MS = 60_000;
/** Site networks need more than 15s for a ~3MB bundle. Login is not waiting on this. */
export const OTA_DOWNLOAD_TIMEOUT_MS = 90_000;

/** True only after the user has left login, signup, and worker entry. */
export function isAppShellPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

/** Download only with a session and only inside the app shell. */
export function canStartOtaDownload(hasSession: boolean, pathname: string): boolean {
  return hasSession && isAppShellPath(pathname);
}

/**
 * Reload onto a staged bundle only while the app is in the background and
 * the visible page is still the app shell. Never on the login screen.
 */
export function canApplyStagedOta(
  inBackground: boolean,
  pathname: string,
  bundleId: string | null | undefined,
): boolean {
  return inBackground && isAppShellPath(pathname) && !!bundleId;
}

/** True when a check already ran and the next one is still inside the quiet window. */
export function isAutoCheckThrottled(
  now: number,
  lastCheckAt: number,
  minMs = MIN_CHECK_INTERVAL_MS,
): boolean {
  if (lastCheckAt <= 0) return false;
  return now - lastCheckAt < minMs;
}

export function getChannel(): "stable" | "beta" {
  return (localStorage.getItem(CHANNEL_KEY) as any) === "beta" ? "beta" : "stable";
}
export function setChannel(c: "stable" | "beta") {
  localStorage.setItem(CHANNEL_KEY, c);
}

/** Phone and PC share `src/lib/otaVersion.ts`. */
export function cmpVersion(a: string, b: string): number {
  return cmpOtaVersion(a, b);
}

export type OtaStatus = {
  native: boolean;
  channel: "stable" | "beta";
  currentVersion: string;
  latestVersion: string | null;
  mandatory: boolean;
  hasUpdate: boolean;
  message: string;
};

export type OtaCheckOptions = {
  /** Boot/resume: no user-facing noise required. */
  silent?: boolean;
  /**
   * Apply with CapacitorUpdater.set() (reload now) instead of next() (cold start).
   * Default true — workers should not need force-quit.
   */
  preferImmediate?: boolean;
  /** When true mid-flight, skip download/apply so a timed-out boot gate can mount UI. */
  shouldAbort?: () => boolean;
};

export async function getOtaStatus(): Promise<OtaStatus> {
  const channel = getChannel();
  if (!isNativeApp()) {
    return {
      native: false,
      channel,
      currentVersion: "웹",
      latestVersion: null,
      mandatory: false,
      hasUpdate: false,
      message: "웹/PC는 OTA가 필요 없습니다. 새로고침하면 최신입니다.",
    };
  }
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    const current = await CapacitorUpdater.current();
    const currentVersion = String((current as any)?.bundle?.version || "내장");
    const ota = getOtaAnonClient();
    const { data, error } = await ota.rpc("get_latest_app_release", {
      _channel: channel,
      _platform: "android",
    } as any);
    if (error) {
      return {
        native: true,
        channel,
        currentVersion,
        latestVersion: null,
        mandatory: false,
        hasUpdate: false,
        message: "서버 릴리스 조회 실패: " + error.message,
      };
    }
    const release: any = Array.isArray(data) ? data[0] : data;
    const latestVersion = release?.version ? String(release.version) : null;
    const mandatory = !!release?.mandatory;
    const hasUpdate =
      !!latestVersion &&
      cmpVersion(latestVersion, currentVersion === "내장" ? "0.0.0" : currentVersion) > 0;
    return {
      native: true,
      channel,
      currentVersion,
      latestVersion,
      mandatory,
      hasUpdate,
      message: hasUpdate
        ? `새 버전 ${latestVersion} — 자동으로 받아 곧 적용됩니다`
        : latestVersion
          ? `최신입니다 (서버 ${latestVersion})`
          : "게시된 OTA 릴리스가 없습니다",
    };
  } catch (e: any) {
    return {
      native: true,
      channel,
      currentVersion: "?",
      latestVersion: null,
      mandatory: false,
      hasUpdate: false,
      message: "OTA 상태 확인 실패: " + (e?.message || String(e)),
    };
  }
}

/** Download latest bundle if newer. Returns user-facing Korean result. */
export async function checkAndDownloadOta(opts: OtaCheckOptions = {}): Promise<{
  ok: boolean;
  message: string;
  version?: string;
  apply: "immediate" | "next_cold_start" | "none";
  bundleId?: string;
}> {
  const preferImmediate = opts.preferImmediate !== false;
  if (!isNativeApp()) {
    return { ok: true, message: "웹은 새로고침으로 업데이트됩니다.", apply: "none" };
  }
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    // Capgo rollback guard — call as early as possible on each check.
    await CapacitorUpdater.notifyAppReady();
    const current = await CapacitorUpdater.current();
    const currentVersion = String((current as any)?.bundle?.version || "0.0.0");

    if (opts.shouldAbort?.()) {
      return { ok: true, message: "업데이트 확인이 취소되었습니다.", apply: "none" };
    }

    const ota = getOtaAnonClient();
    const { data, error } = await ota.rpc("get_latest_app_release", {
      _channel: getChannel(),
      _platform: "android",
    } as any);
    if (error) return { ok: false, message: "릴리스 조회 실패: " + error.message, apply: "none" };
    const release: any = Array.isArray(data) ? data[0] : data;
    if (!release?.bundle_url || !release?.version) {
      return { ok: true, message: "게시된 업데이트가 없습니다.", apply: "none" };
    }
    if (cmpVersion(String(release.version), currentVersion) <= 0) {
      return {
        ok: true,
        message: `이미 최신입니다 (${release.version})`,
        version: String(release.version),
        apply: "none",
      };
    }

    if (opts.shouldAbort?.()) {
      return { ok: true, message: "업데이트 확인이 취소되었습니다.", apply: "none" };
    }

    let downloadUrl = release.bundle_url as string;
    if (downloadUrl.startsWith("storage:")) {
      const path = downloadUrl.replace(/^storage:/, "");
      const { data: signed, error: sErr } = await ota.storage
        .from("app-updates")
        .createSignedUrl(path, 60 * 60);
      if (sErr || !signed?.signedUrl) {
        return { ok: false, message: "다운로드 URL 생성 실패", apply: "none" };
      }
      downloadUrl = signed.signedUrl;
    }

    const downloadPromise = CapacitorUpdater.download({
      url: downloadUrl,
      version: release.version,
      checksum: release.checksum || undefined,
    } as any);

    const bundle = await Promise.race([
      downloadPromise,
      new Promise<never>((_, reject) =>
        window.setTimeout(
          () => reject(new Error("OTA 다운로드 시간 초과")),
          OTA_DOWNLOAD_TIMEOUT_MS,
        ),
      ),
    ]);

    if (opts.shouldAbort?.()) {
      return { ok: true, message: "업데이트 확인이 취소되었습니다.", apply: "none" };
    }

    // Silent background auto-updates must NEVER reload while the user is operating.
    // Use CapacitorUpdater.next() so it applies smoothly on next cold start.
    const immediate = !opts.silent && (preferImmediate || !!release.mandatory);
    if (immediate) {
      await CapacitorUpdater.set({ id: bundle.id } as any);
      return {
        ok: true,
        message: `${release.version} 적용 중 (잠시 후 새 화면으로 전환됩니다)`,
        version: String(release.version),
        apply: "immediate",
      };
    }
    await CapacitorUpdater.next({ id: bundle.id } as any);
    return {
      ok: true,
      message: `${release.version} 다운로드 완료. 앱을 벗어나면 다음 실행에 적용됩니다.`,
      version: String(release.version),
      apply: "next_cold_start",
      bundleId: String(bundle.id),
    };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e), apply: "none" };
  }
}

let checking = false;
let lastCheckAt = 0;
let resumeHooked = false;
let inBackground = false;
let stagedBundleId: string | null = null;
let shellRetryTimer: number | null = null;

async function hasAuthSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session?.access_token;
  } catch {
    return false;
  }
}

async function applyStagedBundle(reason: string) {
  const id = stagedBundleId;
  if (!id || !canApplyStagedOta(inBackground, window.location.pathname, id)) return;
  stagedBundleId = null;
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.set({ id } as any);
    console.info(`[ota:${reason}] staged bundle will show on next open`);
  } catch (e) {
    stagedBundleId = id;
    console.warn(`[ota:${reason}] apply failed`, e);
  }
}

async function runAutoCheck(
  reason: string,
  force = false,
  opts?: { retryIfOutsideShell?: boolean },
) {
  if (!isNativeApp()) return;
  if (checking) return;
  try {
    const { shouldSkipAutoOta } = await import("./preLoginOta");
    if (shouldSkipAutoOta(Date.now())) {
      console.info(`[ota:${reason}] skipped — pre-login download still settling`);
      return;
    }
  } catch {
    /* pre-login helper unavailable */
  }
  // Path first: do not touch the auth client while login or signup is on screen.
  if (!isAppShellPath(window.location.pathname)) {
    console.info(`[ota:${reason}] skipped — outside app shell`);
    if (opts?.retryIfOutsideShell && shellRetryTimer == null) {
      shellRetryTimer = window.setTimeout(() => {
        shellRetryTimer = null;
        void runAutoCheck("enter-app");
      }, 3_000);
    }
    return;
  }
  checking = true;
  try {
    if (!(await hasAuthSession())) {
      console.info(`[ota:${reason}] skipped — no auth session`);
      return;
    }
    const now = Date.now();
    if (!force && isAutoCheckThrottled(now, lastCheckAt)) return;
    lastCheckAt = now;
    const r = await checkAndDownloadOta({
      silent: true,
      preferImmediate: false,
      shouldAbort: () => !isAppShellPath(window.location.pathname),
    });
    if (r.bundleId) {
      stagedBundleId = r.bundleId;
      console.info(`[ota:${reason}] ${r.message}`);
      await applyStagedBundle(`${reason}:already-away`);
    }
  } catch (e) {
    console.warn(`[ota:${reason}] failed`, e);
  } finally {
    checking = false;
  }
}

/**
 * Triggers a silent, non-blocking background OTA check without freezing UI.
 * Used after session restore and key events like check-in/out completion.
 */
export function triggerBackgroundOtaCheck(reason: string, delayMs = 1_500, force = false) {
  window.setTimeout(() => {
    void runAutoCheck(reason, force);
  }, delayMs);
}

function scheduleOtaAfterAuth(reason: string, delayMs = 4_000) {
  window.setTimeout(() => {
    void runAutoCheck(reason, false, { retryIfOutsideShell: true });
  }, delayMs);
}

/**
 * Capgo ready at boot. Download waits until the user is inside /app.
 * Root cause: CapacitorUpdater.download can stall the WebView event loop; if that
 * runs on the login screen, admin signInWithPassword and worker phone sign-in
 * never settle ("처리 중…").
 */
export async function initOtaUpdater() {
  if (!isNativeApp()) return;
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* plugin missing in some builds */
  }

  // Leave lastCheckAt at 0 so the first signed-in check is not swallowed
  // by the 60s quiet window. A stamp here used to skip the 15s timer.

  try {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        stagedBundleId = null;
        return;
      }
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        scheduleOtaAfterAuth(`auth:${event}`, 4_000);
      }
    });
    void subscription;
  } catch (e) {
    console.warn("[ota] auth listener failed", e);
  }

  // Backup for a restored session. Path is checked before any auth read,
  // so a phone sitting on the login screen does not touch the session.
  window.setTimeout(() => {
    if (!isAppShellPath(window.location.pathname)) return;
    void runAutoCheck("session-restore");
  }, 4_000);

  if (resumeHooked) return;
  resumeHooked = true;
  try {
    const { App } = await import("@capacitor/app");
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        inBackground = false;
        void runAutoCheck("resume");
        return;
      }
      inBackground = true;
      void applyStagedBundle("background");
    });
  } catch (e) {
    console.warn("[ota] appStateChange hook failed", e);
  }
}
