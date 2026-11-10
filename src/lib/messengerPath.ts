import { prefersMobileAppShell } from "@/hooks/use-mobile";

export const MESSENGER_ADMIN_PATH = "/app/admin/messenger";
export const MESSENGER_MOBILE_PATH = "/app/worker/messenger";

const PICKER_STATE_KEY = "safenex_messenger_picker_state_v1";
/** Keep picker return state valid for up to 3 minutes while camera/gallery is open. */
const PICKER_STATE_TTL_MS = 3 * 60 * 1000;

export interface MessengerPickerState {
  roomId: string;
  at: number;
}

/** Phone shell must stay under /app/worker. /app/admin/messenger is bounced home. */
export function messengerHomePath(opts?: { mobileShell?: boolean }): string {
  const mobile = opts?.mobileShell ?? (typeof window !== "undefined" && prefersMobileAppShell());
  return mobile ? MESSENGER_MOBILE_PATH : MESSENGER_ADMIN_PATH;
}

export function messengerRoomPath(
  roomId: string,
  opts?: { mobileShell?: boolean },
): string {
  const base = messengerHomePath(opts);
  const clean = String(roomId || "").trim();
  return clean ? `${base}?room=${encodeURIComponent(clean)}` : base;
}

/**
 * Record that the user just opened the OS file/photo picker inside a Messenger room.
 * If Android/iOS WebView recreates the Activity or reloads at `/` or `/app/worker/today`
 * when returning from the picker, route guards can restore the exact chat room.
 */
export function markMessengerPickerActive(roomId: string, now = Date.now()): void {
  const clean = String(roomId || "").trim();
  if (!clean || typeof window === "undefined") return;
  const payload = JSON.stringify({ roomId: clean, at: now } satisfies MessengerPickerState);
  try {
    window.sessionStorage.setItem(PICKER_STATE_KEY, payload);
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.setItem(PICKER_STATE_KEY, payload);
  } catch {
    /* ignore */
  }
}

export function clearMessengerPickerActive(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PICKER_STATE_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.removeItem(PICKER_STATE_KEY);
  } catch {
    /* ignore */
  }
}

export function readMessengerPickerState(now = Date.now()): MessengerPickerState | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PICKER_STATE_KEY);
  } catch {
    raw = null;
  }
  if (!raw) {
    try {
      raw = window.localStorage.getItem(PICKER_STATE_KEY);
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MessengerPickerState>;
    if (
      !parsed ||
      typeof parsed.roomId !== "string" ||
      !parsed.roomId.trim() ||
      typeof parsed.at !== "number"
    ) {
      clearMessengerPickerActive();
      return null;
    }
    if (now - parsed.at > PICKER_STATE_TTL_MS || now < parsed.at - 60_000) {
      clearMessengerPickerActive();
      return null;
    }
    return { roomId: parsed.roomId.trim(), at: parsed.at };
  } catch {
    clearMessengerPickerActive();
    return null;
  }
}

export function consumeMessengerPickerReturnPath(opts?: {
  mobileShell?: boolean;
  now?: number;
}): string | null {
  const state = readMessengerPickerState(opts?.now);
  if (!state) return null;
  clearMessengerPickerActive();
  return messengerRoomPath(state.roomId, { mobileShell: opts?.mobileShell });
}

