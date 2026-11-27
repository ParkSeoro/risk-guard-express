/**
 * Per-device Messenger Auto-Lock & 4-digit PIN management.
 * Syncs lock/unlock state across main and pop-out windows on the same device.
 */

export type MessengerAutoLockMinutes = 0 | 1 | 3 | 5 | 10 | 30;

export interface MessengerLockState {
  pinHash: string | null;
  timeoutMinutes: MessengerAutoLockMinutes;
  locked: boolean;
  updatedAt: number;
}

const STORAGE_PREFIX = "safenex_messenger_lock_v1:";
const CHANNEL_NAME = "safenex_messenger_lock_sync";
const SAME_TAB_EVENT = "safenex:messenger-lock-change";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export async function hashMessengerPin(userId: string, pin: string): Promise<string> {
  const raw = `safenex-pin:${userId}:${pin}`;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(raw);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback deterministic hash for non-secure test contexts
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16)}`;
}

export function loadMessengerLockState(userId?: string | null): MessengerLockState {
  if (!userId || typeof window === "undefined") {
    return { pinHash: null, timeoutMinutes: 0, locked: false, updatedAt: 0 };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return { pinHash: null, timeoutMinutes: 0, locked: false, updatedAt: 0 };
    const parsed = JSON.parse(raw) as Partial<MessengerLockState>;
    const validTimeouts: MessengerAutoLockMinutes[] = [0, 1, 3, 5, 10, 30];
    const timeoutMinutes = validTimeouts.includes(parsed.timeoutMinutes as MessengerAutoLockMinutes)
      ? (parsed.timeoutMinutes as MessengerAutoLockMinutes)
      : 0;
    return {
      pinHash: typeof parsed.pinHash === "string" && parsed.pinHash.length > 0 ? parsed.pinHash : null,
      timeoutMinutes,
      locked: Boolean(parsed.locked && parsed.pinHash),
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch {
    return { pinHash: null, timeoutMinutes: 0, locked: false, updatedAt: 0 };
  }
}

function broadcastLockState(userId: string, state: MessengerLockState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      ch.postMessage({ userId, state });
      ch.close();
    }
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT, { detail: { userId, state } }));
  } catch {
    /* ignore */
  }
}

export async function saveMessengerLockConfig(
  userId: string,
  opts: { pin?: string; timeoutMinutes: MessengerAutoLockMinutes; lockNow?: boolean },
): Promise<MessengerLockState> {
  const prev = loadMessengerLockState(userId);
  const nextPinHash = opts.pin ? await hashMessengerPin(userId, opts.pin) : prev.pinHash;
  const next: MessengerLockState = {
    pinHash: nextPinHash,
    timeoutMinutes: opts.timeoutMinutes,
    locked: nextPinHash ? Boolean(opts.lockNow ?? prev.locked) : false,
    updatedAt: Date.now(),
  };
  broadcastLockState(userId, next);
  return next;
}

export async function verifyMessengerPin(userId: string, pin: string): Promise<boolean> {
  const state = loadMessengerLockState(userId);
  if (!state.pinHash) return false;
  const candidate = await hashMessengerPin(userId, pin);
  return candidate === state.pinHash;
}

export function setMessengerLocked(userId: string, locked: boolean): MessengerLockState {
  const prev = loadMessengerLockState(userId);
  if (!prev.pinHash && locked) return prev;
  const next: MessengerLockState = {
    ...prev,
    locked: Boolean(locked && prev.pinHash),
    updatedAt: Date.now(),
  };
  broadcastLockState(userId, next);
  return next;
}

export function disableMessengerLock(userId: string): MessengerLockState {
  const next: MessengerLockState = {
    pinHash: null,
    timeoutMinutes: 0,
    locked: false,
    updatedAt: Date.now(),
  };
  broadcastLockState(userId, next);
  return next;
}

export function subscribeMessengerLockSync(
  userId: string,
  onChange: (state: MessengerLockState) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKey(userId)) {
      onChange(loadMessengerLockState(userId));
    }
  };
  window.addEventListener("storage", onStorage);

  let ch: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      ch = new BroadcastChannel(CHANNEL_NAME);
      ch.onmessage = (ev) => {
        if (ev.data?.userId === userId && ev.data?.state) {
          onChange(ev.data.state as MessengerLockState);
        }
      };
    }
  } catch {
    /* ignore */
  }

  const onSameTab = (e: Event) => {
    const detail = (e as CustomEvent<{ userId?: string; state?: MessengerLockState }>).detail;
    if (detail?.userId === userId && detail?.state) {
      onChange(detail.state);
    }
  };
  window.addEventListener(SAME_TAB_EVENT, onSameTab);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SAME_TAB_EVENT, onSameTab);
    try {
      ch?.close();
    } catch {
      /* ignore */
    }
  };
}
