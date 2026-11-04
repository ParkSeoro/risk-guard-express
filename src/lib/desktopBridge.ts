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
