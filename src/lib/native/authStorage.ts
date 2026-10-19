/**
 * Durable auth session storage for Capacitor.
 * OS may clear WebView localStorage; Preferences uses SharedPreferences / UserDefaults.
 * Web/PWA keeps localStorage.
 *
 * Critical: JS can ship via OTA before the native Preferences plugin is in the store binary.
 * Never call the Preferences bridge unless Capacitor reports the plugin is available, and
 * any bridge hang/throw must fall back to localStorage so auth boot cannot wedge.
 */
import { Capacitor } from "@capacitor/core";

export type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

const MIGRATED_FLAG = "safenex-auth-prefs-migrated-v1";
/** Bridge calls that never settle (missing native impl) must not block getSession(). */
const PREFS_CALL_TIMEOUT_MS = 800;

function isNativePlatform(): boolean {
  try {
    return !!Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/** True only when the native binary registered the Preferences plugin. */
export function isPreferencesPluginAvailable(): boolean {
  try {
    if (!isNativePlatform()) return false;
    return !!Capacitor.isPluginAvailable?.("Preferences");
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
let prefsDisabled = false;
let migratePromise: Promise<void> | null = null;

function disablePreferences(reason: unknown): void {
  if (!prefsDisabled) {
    console.warn("[authStorage] Preferences disabled — using localStorage", reason);
  }
  prefsDisabled = true;
  prefsApi = null;
  migratePromise = null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`[authStorage] ${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function loadPreferences(): Promise<PrefsApi | null> {
  if (prefsDisabled) return null;
  if (prefsApi !== undefined) return prefsApi;
  if (!isPreferencesPluginAvailable()) {
    prefsApi = null;
    return null;
  }
  try {
    const mod = await withTimeout(
      import("@capacitor/preferences"),
      PREFS_CALL_TIMEOUT_MS,
      "import(@capacitor/preferences)",
    );
    prefsApi = mod.Preferences;
    return prefsApi;
  } catch (e) {
    disablePreferences(e);
    return null;
  }
}

async function prefsGet(prefs: PrefsApi, key: string): Promise<string | null> {
  const { value } = await withTimeout(prefs.get({ key }), PREFS_CALL_TIMEOUT_MS, `Preferences.get(${key})`);
  return value;
}

async function prefsSet(prefs: PrefsApi, key: string, value: string): Promise<void> {
  await withTimeout(prefs.set({ key, value }), PREFS_CALL_TIMEOUT_MS, `Preferences.set(${key})`);
}

async function prefsRemove(prefs: PrefsApi, key: string): Promise<void> {
  await withTimeout(prefs.remove({ key }), PREFS_CALL_TIMEOUT_MS, `Preferences.remove(${key})`);
}

/** One-time copy so an OTA that switches storage does not force re-login. */
export async function migrateLocalStorageAuthToPreferences(
  prefs: PrefsApi,
  webStorage: Storage = typeof localStorage !== "undefined" ? localStorage : (undefined as unknown as Storage),
): Promise<number> {
  if (!webStorage) return 0;
  try {
    const flag = await prefsGet(prefs, MIGRATED_FLAG);
    if (flag === "1") return 0;
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
    const existing = await prefsGet(prefs, key);
    if (existing) continue;
    await prefsSet(prefs, key, value);
    copied += 1;
  }
  await prefsSet(prefs, MIGRATED_FLAG, "1");
  return copied;
}

function ensureMigrated(prefs: PrefsApi): Promise<void> {
  if (!migratePromise) {
    migratePromise = migrateLocalStorageAuthToPreferences(prefs)
      .then(() => undefined)
      .catch((e) => {
        disablePreferences(e);
      });
  }
  return migratePromise;
}

function webLocalStorage(): AuthStorage {
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

  // Web/PWA, or native binary without Preferences: never touch the bridge.
  if (!isNativePlatform() || !isPreferencesPluginAvailable()) {
    return webLocalStorage();
  }

  return {
    getItem: async (key) => {
      try {
        const prefs = await loadPreferences();
        if (!prefs) return window.localStorage.getItem(key);
        await ensureMigrated(prefs);
        if (prefsDisabled) return window.localStorage.getItem(key);
        const value = await prefsGet(prefs, key);
        // Prefer Preferences; if empty, fall back to localStorage (pre-migrate / mirror).
        if (value != null) return value;
        return window.localStorage.getItem(key);
      } catch (e) {
        disablePreferences(e);
        return window.localStorage.getItem(key);
      }
    },
    setItem: async (key, value) => {
      try {
        const prefs = await loadPreferences();
        if (!prefs) {
          window.localStorage.setItem(key, value);
          return;
        }
        await ensureMigrated(prefs);
        if (prefsDisabled) {
          window.localStorage.setItem(key, value);
          return;
        }
        await prefsSet(prefs, key, value);
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* ignore quota */
        }
      } catch (e) {
        disablePreferences(e);
        window.localStorage.setItem(key, value);
      }
    },
    removeItem: async (key) => {
      try {
        const prefs = await loadPreferences();
        if (!prefs) {
          window.localStorage.removeItem(key);
          return;
        }
        await prefsRemove(prefs, key);
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      } catch (e) {
        disablePreferences(e);
        window.localStorage.removeItem(key);
      }
    },
  };
}
