/**
 * SafeNex Windows Desktop Bridge (`window.safenexDesktop`)
 * - Bridges Electron / Tauri / Web environments seamlessly.
 * - Manages Windows Auto-Start on Boot, Keep Logged In (Credential Memory),
 *   Minimize-to-Tray on Close, Compact (KakaoTalk 420px) vs Expanded (1440px) Window Mode,
 *   Multi-Window Pop-out Chat / Work Modules, and Taskbar Unread Badge & FlashFrame.
 */

export type DesktopWindowMode = "compact" | "expanded";
export type DesktopPresenceStatus = "online" | "busy" | "away" | "inspecting";

export interface DesktopAppSettings {
  /** 윈도우 시작 시 자동 실행 (Auto-Start on Windows Login) */
  autoStartOnBoot: boolean;
  /** 자동 로그인 / 로그인 정보 저장 (Keep Logged In) */
  keepLoggedIn: boolean;
  /** 창 닫기(X) 시 종료하지 않고 트레이로 최소화 */
  minimizeToTrayOnClose: boolean;
  /** 시작 시 카톡형 미니모드(420px)로 실행할지, 통합 워크스페이스로 실행할지 */
  defaultWindowMode: DesktopWindowMode;
  /** 새 메시지 도착 시 우측 하단 배너 및 작업표시줄 깜빡임 */
  desktopNotificationBanner: boolean;
  /** 알림음 재생 여부 */
  soundNotification: boolean;
  /** 항상 위(Always on Top) 고정 (미니모드에서 유용) */
  alwaysOnTop: boolean;
  /** 로그인 후 기본 시작 화면을 카톡형 데스크톱 워크스페이스로 설정 */
  launchMessengerWorkspaceOnLogin: boolean;
}

export interface ManagerSavedLogin {
  email: string;
  rememberEmail: boolean;
  autoLoginEnabled: boolean;
  updatedAt: string;
}

export interface SafeNexNativeDesktopAPI {
  isDesktopApp?: boolean;
  platform?: string;
  appVersion?: string;
  setAutoStart?: (enabled: boolean) => Promise<boolean> | void;
  getAutoStart?: () => Promise<boolean>;
  setMinimizeToTray?: (enabled: boolean) => Promise<boolean> | void;
  setAlwaysOnTop?: (enabled: boolean) => Promise<boolean> | void;
  setWindowMode?: (mode: DesktopWindowMode) => Promise<void> | void;
  openPopoutWindow?: (opts: {
    url: string;
    title?: string;
    width?: number;
    height?: number;
  }) => Promise<void> | void;
  setBadgeCount?: (count: number) => Promise<void> | void;
  flashFrame?: (flash: boolean) => Promise<void> | void;
  minimizeWindow?: () => void;
  maximizeOrRestoreWindow?: () => void;
  hideToTray?: () => void;
}

declare global {
  interface Window {
    safenexDesktop?: SafeNexNativeDesktopAPI;
  }
}

const DESKTOP_SETTINGS_KEY = "safenex_desktop_settings_v1";
const MANAGER_LOGIN_MEMORY_KEY = "safenex_manager_login_memory_v1";
const PRESENCE_STATUS_KEY = "safenex_desktop_presence_v1";
const DESKTOP_SHELL_SESSION_KEY = "safenex_pc_shell";

export const DEFAULT_DESKTOP_SETTINGS: DesktopAppSettings = {
  autoStartOnBoot: true,
  keepLoggedIn: true,
  minimizeToTrayOnClose: true,
  defaultWindowMode: "compact",
  desktopNotificationBanner: true,
  soundNotification: true,
  alwaysOnTop: false,
  launchMessengerWorkspaceOnLogin: false,
};

/**
 * Checks if currently running inside the packaged Windows Desktop `.exe` shell (Electron / Tauri).
 */
export function isWindowsDesktopApp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.safenexDesktop?.isDesktopApp) return true;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  return ua.includes("SafeNexDesktop") || ua.includes("Electron/");
}

/**
 * Whether the unified PC Messenger & Groupware Shell (left hover-expanding icon rail + in-place content)
 * is active in the current window.
 */
export function isDesktopShellActive(): boolean {
  if (typeof window === "undefined") return false;
  if (isWindowsDesktopApp()) return true;
  try {
    if (window.sessionStorage.getItem(DESKTOP_SHELL_SESSION_KEY) === "1") {
      return true;
    }
    if (window.location.pathname.includes("/desktop-workspace")) {
      window.sessionStorage.setItem(DESKTOP_SHELL_SESSION_KEY, "1");
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function setDesktopShellActive(active: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (active) {
      window.sessionStorage.setItem(DESKTOP_SHELL_SESSION_KEY, "1");
      window.localStorage.setItem("forceDesktopUI", "1");
    } else {
      window.sessionStorage.removeItem(DESKTOP_SHELL_SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Returns the recommended window dimensions for a given route inside the single-window PC shell.
 * - Messenger (대화상대 / 대화목록): 420 × 680 (콤팩트 메신저 창, 사이드바 마우스 오버 열림)
 * - Work Mode (알림 / 공지사항 이하 모든 업무 화면): 1260 × 820 단일 크기 통일 (좌측 168px 고정 사이드바 + 우측 1092px 데스크톱 레이아웃 보장)
 */
export const DESKTOP_MESSENGER_WINDOW_SIZE = { width: 420, height: 680 } as const;
export const DESKTOP_WORK_WINDOW_SIZE = { width: 1260, height: 820 } as const;

export function resolveDesktopRouteWindowSize(pathname: string): {
  width: number;
  height: number;
  isMessengerView: boolean;
} {
  const p = pathname || "";
  if (p.includes("/desktop-workspace") || p.includes("/messenger")) {
    return {
      width: DESKTOP_MESSENGER_WINDOW_SIZE.width,
      height: DESKTOP_MESSENGER_WINDOW_SIZE.height,
      isMessengerView: true,
    };
  }
  return {
    width: DESKTOP_WORK_WINDOW_SIZE.width,
    height: DESKTOP_WORK_WINDOW_SIZE.height,
    isMessengerView: false,
  };
}

/**
 * Smoothly resizes the current window in-place and keeps it within the monitor's working area.
 * Uses both standard browser APIs and the local C# Win32 endpoint (`/__desktop/resize`) when running in SafeNexPC.exe.
 */
export function resizeDesktopWindow(width: number, height: number): void {
  if (typeof window === "undefined") return;
  const targetW = Math.max(360, Math.round(width));
  const targetH = Math.max(520, Math.round(height));

  try {
    const availW = window.screen?.availWidth || 1920;
    const availH = window.screen?.availHeight || 1040;
    const availLeft = (window.screen as unknown as { availLeft?: number })?.availLeft || 0;
    const availTop = (window.screen as unknown as { availTop?: number })?.availTop || 0;

    // Anchor right edge near current right edge (or bottom-right corner) so expanding from 420->960
    // shifts left instead of overflowing off the right edge of the monitor.
    const curRight = window.screenX + window.outerWidth;
    const curTop = window.screenY;

    let nextX = curRight - targetW;
    if (nextX + targetW > availLeft + availW - 12) {
      nextX = availLeft + availW - targetW - 16;
    }
    if (nextX < availLeft + 12) {
      nextX = availLeft + 16;
    }

    let nextY = curTop;
    if (nextY + targetH > availTop + availH - 12) {
      nextY = Math.max(availTop + 16, availTop + availH - targetH - 16);
    }
    if (nextY < availTop + 12) {
      nextY = availTop + 16;
    }

    window.resizeTo(targetW, targetH);
    window.moveTo(nextX, nextY);
  } catch {
    /* ignore if browser blocks window.resizeTo */
  }

  // Native Windows C# local server endpoint (`SafeNexPC.exe`)
  if (
    isWindowsDesktopApp() ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
  ) {
    try {
      void fetch(`/__desktop/resize?w=${targetW}&h=${targetH}`, {
        method: "GET",
        cache: "no-store",
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

export function loadDesktopSettings(): DesktopAppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_DESKTOP_SETTINGS };
  try {
    const raw = window.localStorage.getItem(DESKTOP_SETTINGS_KEY);
    if (!raw) {
      const defaults = {
        ...DEFAULT_DESKTOP_SETTINGS,
        // 네이티브 PC 앱(.exe)에서는 로그인 직후 카톡형 워크스페이스를 기본 홈으로 사용
        launchMessengerWorkspaceOnLogin: isWindowsDesktopApp(),
      };
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<DesktopAppSettings>;
    return {
      autoStartOnBoot:
        typeof parsed.autoStartOnBoot === "boolean"
          ? parsed.autoStartOnBoot
          : DEFAULT_DESKTOP_SETTINGS.autoStartOnBoot,
      keepLoggedIn:
        typeof parsed.keepLoggedIn === "boolean"
          ? parsed.keepLoggedIn
          : DEFAULT_DESKTOP_SETTINGS.keepLoggedIn,
      minimizeToTrayOnClose:
        typeof parsed.minimizeToTrayOnClose === "boolean"
          ? parsed.minimizeToTrayOnClose
          : DEFAULT_DESKTOP_SETTINGS.minimizeToTrayOnClose,
      defaultWindowMode:
        parsed.defaultWindowMode === "compact" || parsed.defaultWindowMode === "expanded"
          ? parsed.defaultWindowMode
          : DEFAULT_DESKTOP_SETTINGS.defaultWindowMode,
      desktopNotificationBanner:
        typeof parsed.desktopNotificationBanner === "boolean"
          ? parsed.desktopNotificationBanner
          : DEFAULT_DESKTOP_SETTINGS.desktopNotificationBanner,
      soundNotification:
        typeof parsed.soundNotification === "boolean"
          ? parsed.soundNotification
          : DEFAULT_DESKTOP_SETTINGS.soundNotification,
      alwaysOnTop:
        typeof parsed.alwaysOnTop === "boolean"
          ? parsed.alwaysOnTop
          : DEFAULT_DESKTOP_SETTINGS.alwaysOnTop,
      launchMessengerWorkspaceOnLogin:
        typeof parsed.launchMessengerWorkspaceOnLogin === "boolean"
          ? parsed.launchMessengerWorkspaceOnLogin
          : isWindowsDesktopApp(),
    };
  } catch {
    return { ...DEFAULT_DESKTOP_SETTINGS };
  }
}

export function saveDesktopSettings(
  patch: Partial<DesktopAppSettings>,
): DesktopAppSettings {
  const current = loadDesktopSettings();
  const next: DesktopAppSettings = { ...current, ...patch };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DESKTOP_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota errors */
    }
    // Sync to native Windows shell if available
    const api = window.safenexDesktop;
    if (api) {
      if (patch.autoStartOnBoot !== undefined) {
        void api.setAutoStart?.(next.autoStartOnBoot);
      }
      if (patch.minimizeToTrayOnClose !== undefined) {
        void api.setMinimizeToTray?.(next.minimizeToTrayOnClose);
      }
      if (patch.alwaysOnTop !== undefined) {
        void api.setAlwaysOnTop?.(next.alwaysOnTop);
      }
    }
  }
  return next;
}

/**
 * Manager Login Memory (이메일 저장 및 자동 로그인 설정)
 */
export function loadManagerLoginMemory(): ManagerSavedLogin {
  if (typeof window === "undefined") {
    return {
      email: "",
      rememberEmail: true,
      autoLoginEnabled: true,
      updatedAt: "",
    };
  }
  try {
    const raw = window.localStorage.getItem(MANAGER_LOGIN_MEMORY_KEY);
    if (!raw) {
      return {
        email: "",
        rememberEmail: true,
        autoLoginEnabled: true,
        updatedAt: "",
      };
    }
    const parsed = JSON.parse(raw) as Partial<ManagerSavedLogin>;
    return {
      email: typeof parsed.email === "string" ? parsed.email : "",
      rememberEmail: parsed.rememberEmail !== false,
      autoLoginEnabled: parsed.autoLoginEnabled !== false,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return {
      email: "",
      rememberEmail: true,
      autoLoginEnabled: true,
      updatedAt: "",
    };
  }
}

export function saveManagerLoginMemory(opts: {
  email: string;
  rememberEmail: boolean;
  autoLoginEnabled: boolean;
}): void {
  if (typeof window === "undefined") return;
  try {
    const payload: ManagerSavedLogin = {
      email: opts.rememberEmail ? opts.email.trim() : "",
      rememberEmail: opts.rememberEmail,
      autoLoginEnabled: opts.autoLoginEnabled,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(MANAGER_LOGIN_MEMORY_KEY, JSON.stringify(payload));
    saveDesktopSettings({ keepLoggedIn: opts.autoLoginEnabled });
  } catch {
    /* ignore */
  }
}

/**
 * Presence status (온라인 / 점검중 / 자리비움 / 바쁨)
 */
export function loadDesktopPresence(): DesktopPresenceStatus {
  if (typeof window === "undefined") return "online";
  try {
    const raw = window.localStorage.getItem(PRESENCE_STATUS_KEY);
    if (raw === "online" || raw === "busy" || raw === "away" || raw === "inspecting") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "online";
}

export function saveDesktopPresence(status: DesktopPresenceStatus): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRESENCE_STATUS_KEY, status);
  } catch {
    /* ignore */
  }
}

/**
 * Resize the native Windows `.exe` window between Compact KakaoTalk mode (420x740)
 * and Expanded Split Workspace mode (1440x900).
 */
export function applyDesktopWindowMode(mode: DesktopWindowMode): void {
  saveDesktopSettings({ defaultWindowMode: mode });
  if (typeof window === "undefined") return;
  if (window.safenexDesktop?.setWindowMode) {
    void window.safenexDesktop.setWindowMode(mode);
  }
}

/**
 * Open a standalone pop-out window (like double-clicking a chat room in KakaoTalk PC,
 * or popping out a Work Permit / Safety Cost / Dashboard window).
 * Passes `?popout=1` so `AppLayout` hides the web sidebar and renders a clean standalone window.
 */
export function openDesktopPopoutWindow(opts: {
  url: string;
  title?: string;
  width?: number;
  height?: number;
  windowName?: string;
}): void {
  if (typeof window === "undefined") return;
  const width = opts.width ?? 460;
  const height = opts.height ?? 720;

  let finalUrl = opts.url;
  if (!finalUrl.includes("popout=1")) {
    finalUrl += finalUrl.includes("?") ? "&popout=1" : "?popout=1";
  }

  if (window.safenexDesktop?.openPopoutWindow) {
    void window.safenexDesktop.openPopoutWindow({
      url: finalUrl,
      title: opts.title || "SafeNex",
      width,
      height,
    });
    return;
  }
  const left = Math.max(40, Math.round((window.screen.width - width) / 2));
  const top = Math.max(40, Math.round((window.screen.height - height) / 2));
  const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
  const winName = opts.windowName || opts.title || "_blank";
  const win = window.open(finalUrl, winName, features);
  win?.focus();
}

/**
 * Update Windows Taskbar / System Tray unread badge and optionally flash taskbar icon.
 */
export function updateDesktopTaskbarBadge(
  totalCount: number,
  opts?: { flash?: boolean },
): void {
  if (typeof window === "undefined") return;
  const safeCount = Math.max(0, Math.floor(totalCount));
  if (window.safenexDesktop?.setBadgeCount) {
    void window.safenexDesktop.setBadgeCount(safeCount);
  }
  if (opts?.flash && safeCount > 0 && window.safenexDesktop?.flashFrame) {
    void window.safenexDesktop.flashFrame(true);
  }
  // Web App Badging API fallback (installed PWA / Edge / Chrome on Windows)
  if ("setAppBadge" in navigator && typeof (navigator as any).setAppBadge === "function") {
    if (safeCount > 0) {
      void (navigator as any).setAppBadge(safeCount).catch(() => {});
    } else if (typeof (navigator as any).clearAppBadge === "function") {
      void (navigator as any).clearAppBadge().catch(() => {});
    }
  }
}

export interface DesktopOtaCheckResult {
  ok: boolean;
  hasUpdate: boolean;
  applied: boolean;
  currentVersion: string;
  latestVersion: string | null;
  mandatory?: boolean;
  notes?: string | null;
  message: string;
}

const DESKTOP_BUNDLE_VERSION_KEY = "safenex_pc_bundle_version";

function cmpDesktopVersion(a: string, b: string): number {
  const parts = (v: string) => {
    const nums = String(v || "").match(/\d+/g);
    return nums ? nums.map((n) => Number(n)) : [0];
  };
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Queries the local SafeNexPC.exe HTTP server for its current bundle version.
 */
export async function getDesktopVersionInfo(): Promise<{
  appVersion: string;
  bundleVersion: string;
}> {
  const fallbackAppVersion =
    (typeof window !== "undefined" && window.safenexDesktop?.appVersion) || "1.1.3";
  let savedBundle = fallbackAppVersion;
  if (typeof window !== "undefined") {
    try {
      savedBundle =
        window.localStorage.getItem(DESKTOP_BUNDLE_VERSION_KEY) || fallbackAppVersion;
    } catch {
      /* ignore */
    }
  }

  if (
    typeof window !== "undefined" &&
    (isWindowsDesktopApp() ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost")
  ) {
    try {
      const res = await fetch("/__desktop/version", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as {
          appVersion?: string;
          bundleVersion?: string;
        };
        const bundleVersion = json.bundleVersion || savedBundle;
        try {
          window.localStorage.setItem(DESKTOP_BUNDLE_VERSION_KEY, bundleVersion);
        } catch {
          /* ignore */
        }
        return {
          appVersion: json.appVersion || fallbackAppVersion,
          bundleVersion,
        };
      }
    } catch {
      /* ignore */
    }
  }

  return {
    appVersion: fallbackAppVersion,
    bundleVersion: savedBundle,
  };
}

/**
 * Zero-Reinstall OTA Auto-Updater for SafeNex PC:
 * Checks Supabase `app_releases` (published automatically by GitHub Actions on every push to `main`
 * or via `/app/admin/settings/mobile-releases`) and instructs the local `SafeNexPC.exe` server
 * (`/__desktop/apply-ota`) to download and hot-swap `%LOCALAPPDATA%\SafeNexPC\www` in place.
 * Users NEVER need to receive or run a new `.exe` installer for web/UI/feature updates.
 */
export async function checkAndApplyDesktopOtaUpdate(opts?: {
  channel?: "stable" | "beta";
}): Promise<DesktopOtaCheckResult> {
  const channel = opts?.channel || "stable";
  const { bundleVersion: currentVersion } = await getDesktopVersionInfo();

  try {
    const { getOtaAnonClient } = await import("@/lib/native/otaAnonClient");
    const ota = getOtaAnonClient();
    const { data, error } = await ota.rpc("get_latest_app_release", {
      _channel: channel,
    } as any);

    if (error) {
      return {
        ok: false,
        hasUpdate: false,
        applied: false,
        currentVersion,
        latestVersion: null,
        message: `업데이트 서버 조회 실패: ${error.message}`,
      };
    }

    const release: any = Array.isArray(data) ? data[0] : data;
    if (!release?.version || !release?.bundle_url) {
      return {
        ok: true,
        hasUpdate: false,
        applied: false,
        currentVersion,
        latestVersion: null,
        message: `현재 최신 버전(${currentVersion})을 사용 중입니다.`,
      };
    }

    const latestVersion = String(release.version);
    const hasUpdate = cmpDesktopVersion(latestVersion, currentVersion) > 0;
    if (!hasUpdate) {
      return {
        ok: true,
        hasUpdate: false,
        applied: false,
        currentVersion,
        latestVersion,
        message: `현재 최신 버전(${currentVersion})입니다.`,
      };
    }

    let downloadUrl = String(release.bundle_url);
    if (downloadUrl.startsWith("storage:")) {
      const storagePath = downloadUrl.replace(/^storage:/, "");
      const { data: signed, error: signErr } = await ota.storage
        .from("app-updates")
        .createSignedUrl(storagePath, 60 * 60);
      if (signErr || !signed?.signedUrl) {
        return {
          ok: false,
          hasUpdate: true,
          applied: false,
          currentVersion,
          latestVersion,
          message: "업데이트 패키지 서명 URL 생성에 실패했습니다.",
        };
      }
      downloadUrl = signed.signedUrl;
    }

    // Instruct local SafeNexPC.exe resident server to download & extract the new bundle into %LOCALAPPDATA%\SafeNexPC\www
    const applyRes = await fetch(
      `/__desktop/apply-ota?version=${encodeURIComponent(latestVersion)}&url=${encodeURIComponent(downloadUrl)}`,
      {
        method: "POST",
        cache: "no-store",
      },
    );

    if (!applyRes.ok) {
      return {
        ok: false,
        hasUpdate: true,
        applied: false,
        currentVersion,
        latestVersion,
        message: `로컬 업데이트 적용 실패 (HTTP ${applyRes.status})`,
      };
    }

    const applyJson = (await applyRes.json()) as { ok?: boolean; error?: string };
    if (!applyJson.ok) {
      return {
        ok: false,
        hasUpdate: true,
        applied: false,
        currentVersion,
        latestVersion,
        message: applyJson.error || "로컬 업데이트 교체 중 오류가 발생했습니다.",
      };
    }

    try {
      window.localStorage.setItem(DESKTOP_BUNDLE_VERSION_KEY, latestVersion);
    } catch {
      /* ignore */
    }

    return {
      ok: true,
      hasUpdate: true,
      applied: true,
      currentVersion,
      latestVersion,
      mandatory: Boolean(release.mandatory),
      notes: release.notes || null,
      message: `새 버전(v${latestVersion}) 다운로드 및 설치가 완료되었습니다.`,
    };
  } catch (err: any) {
    return {
      ok: false,
      hasUpdate: false,
      applied: false,
      currentVersion,
      latestVersion: null,
      message: err?.message || "업데이트 확인 중 오류가 발생했습니다.",
    };
  }
}

export const SAFENEX_PUBLIC_SITE_ORIGIN = "https://safenex.org";

/**
 * Resolves the full public website URL for the current route inside the PC program.
 * - If currently on the messenger view (`/desktop-workspace` or `/messenger`), opens `/app/admin` (the full web dashboard).
 * - If currently on a work view (e.g., `/app/admin/work-permits`), opens that exact path on `https://safenex.org`.
 */
export function resolveSafeNexWebSiteUrl(
  pathname?: string,
  search?: string,
): string {
  const p = (pathname || "").trim();
  if (!p || p === "/" || p.includes("/desktop-workspace") || p.includes("/messenger")) {
    return `${SAFENEX_PUBLIC_SITE_ORIGIN}/app/admin`;
  }
  const cleanPath = p.startsWith("/") ? p : `/${p}`;
  const cleanSearch = search && search.startsWith("?") ? search : "";
  return `${SAFENEX_PUBLIC_SITE_ORIGIN}${cleanPath}${cleanSearch}`;
}

/**
 * Opens the SafeNex official website (`https://safenex.org`) in the user's default desktop browser (Chrome/Edge normal tab).
 */
export function openSafeNexWebSite(pathname?: string, search?: string): void {
  if (typeof window === "undefined") return;
  const targetUrl = resolveSafeNexWebSiteUrl(
    pathname ?? window.location.pathname,
    search ?? window.location.search,
  );

  if (
    isWindowsDesktopApp() ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
  ) {
    fetch(`/__desktop/open-external?url=${encodeURIComponent(targetUrl)}`, {
      method: "GET",
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) {
          window.open(targetUrl, "_blank", "noopener,noreferrer");
        }
      })
      .catch(() => {
        window.open(targetUrl, "_blank", "noopener,noreferrer");
      });
    return;
  }

  window.open(targetUrl, "_blank", "noopener,noreferrer");
}
