/**
 * Durable auth session storage for Capacitor.
 * OS may clear WebView localStorage; Preferences uses SharedPreferences / UserDefaults.
 * Web/PWA keeps localStorage. Old native builds without the plugin fall back to localStorage.
 */
import { Capacitor } from "@capacitor/core";

export type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

const MIGRATED_FLAG = "safenex-auth-prefs-migrated-v1";

function isNativePlatform(): boolean {
  try {
    return !!Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/** Keys supabase-js persists (e.g. sb-<project-ref>-auth-token). */
export function isSupabaseAuthStorageKey(key: string): boolean {
  return /(?:^|-)auth-token(?:$|-)/.test(key) || key.includes("-auth-token");
}

type PrefsApi = {
  get: (opts: { key: string }) => Promise<{ value: string | null }>;
  set: (opts: { key: string; value: string }) => Promise<void>;
  remove: (opts: { key: string }) => Promise<void>;
};

let prefsApi: PrefsApi | null | undefined;
let migratePromise: Promise<void> | null = null;

async function loadPreferences(): Promise<PrefsApi | null> {
  if (prefsApi !== undefined) return prefsApi;
  if (!isNativePlatform()) {
    prefsApi = null;
    return null;
  }
  try {
    const mod = await import("@capacitor/preferences");
    prefsApi = mod.Preferences;
    return prefsApi;
  } catch (e) {
    console.warn("[authStorage] Preferences unavailable — using localStorage", e);
    prefsApi = null;
    return null;
  }
}

/** One-time copy so an OTA that switches storage does not force re-login. */
export async function migrateLocalStorageAuthToPreferences(
  prefs: PrefsApi,
  webStorage: Storage = typeof localStorage !== "undefined" ? localStorage : (undefined as unknown as Storage),
): Promise<number> {
  if (!webStorage) return 0;
  try {
    const flag = await prefs.get({ key: MIGRATED_FLAG });
    if (flag.value === "1") return 0;
  } catch {
    /* continue and try migrate */
  }

  let copied = 0;
  const keys: string[] = [];
  for (let i = 0; i < webStorage.length; i++) {
    const key = webStorage.key(i);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    if (!isSupabaseAuthStorageKey(key)) continue;
    const value = webStorage.getItem(key);
    if (!value) continue;
    const existing = await prefs.get({ key });
    if (existing.value) continue;
    await prefs.set({ key, value });
    copied += 1;
  }
  await prefs.set({ key: MIGRATED_FLAG, value: "1" });
  return copied;
}

function ensureMigrated(prefs: PrefsApi): Promise<void> {
  if (!migratePromise) {
    migratePromise = migrateLocalStorageAuthToPreferences(prefs).then(() => undefined);
  }
  return migratePromise;
}

export function createAuthStorage(): AuthStorage {
  if (typeof window === "undefined") {
    const mem = new Map<string, string>();
    return {
      getItem: (key) => mem.get(key) ?? null,
      setItem: (key, value) => {
        mem.set(key, value);
      },
      removeItem: (key) => {
        mem.delete(key);
      },
    };
  }

  if (!isNativePlatform()) {
    return {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => {
        window.localStorage.setItem(key, value);
      },
      removeItem: (key) => {
        window.localStorage.removeItem(key);
      },
    };
  }

  return {
    getItem: async (key) => {
      const prefs = await loadPreferences();
      if (!prefs) return window.localStorage.getItem(key);
      await ensureMigrated(prefs);
      const { value } = await prefs.get({ key });
      return value;
    },
    setItem: async (key, value) => {
      const prefs = await loadPreferences();
      if (!prefs) {
        window.localStorage.setItem(key, value);
        return;
      }
      await ensureMigrated(prefs);
      await prefs.set({ key, value });
      // Keep a localStorage mirror so mid-rollout / rollback still finds a session.
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* ignore quota */
      }
    },
    removeItem: async (key) => {
      const prefs = await loadPreferences();
      if (!prefs) {
        window.localStorage.removeItem(key);
        return;
      }
      await prefs.remove({ key });
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
