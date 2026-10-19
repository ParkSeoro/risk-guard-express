/**
 * Auth session storage.
 *
 * Emergency (2026-10-19): Always use WebView localStorage on every platform.
 * Capacitor Preferences + concurrent Capgo OTA download can stall the WebView
 * so Preferences timeouts never fire and signInWithPassword hangs on "처리 중…".
 * Re-enable Preferences only after a dedicated native build proves bridge + OTA
 * coexistence; until then durability beats a wedged login.
 */
import { Capacitor } from "@capacitor/core";

export type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

/** Kept for tests / future re-enable. Currently unused by createAuthStorage. */
export function isPreferencesPluginAvailable(): boolean {
  try {
    if (!Capacitor?.isNativePlatform?.()) return false;
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

/** Test helper — migrate path retained for unit coverage. */
export async function migrateLocalStorageAuthToPreferences(
  prefs: PrefsApi,
  webStorage: Storage = typeof localStorage !== "undefined" ? localStorage : (undefined as unknown as Storage),
): Promise<number> {
  if (!webStorage) return 0;
  const flag = await prefs.get({ key: "safenex-auth-prefs-migrated-v1" });
  if (flag.value === "1") return 0;

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
  await prefs.set({ key: "safenex-auth-prefs-migrated-v1", value: "1" });
  return copied;
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
  return webLocalStorage();
}
