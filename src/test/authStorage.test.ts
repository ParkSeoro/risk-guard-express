import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSupabaseAuthStorageKey,
  migrateLocalStorageAuthToPreferences,
} from "@/lib/native/authStorage";

describe("authStorage helpers", () => {
  it("detects supabase auth token keys", () => {
    expect(isSupabaseAuthStorageKey("sb-qhntxmggacorqjjmjqgo-auth-token")).toBe(true);
    expect(isSupabaseAuthStorageKey("sb-abc-auth-token-code-verifier")).toBe(true);
    expect(isSupabaseAuthStorageKey("sidebar:groups")).toBe(false);
    expect(isSupabaseAuthStorageKey("app-update-channel")).toBe(false);
  });

  it("copies auth keys from localStorage into Preferences once", async () => {
    const store = new Map<string, string>();
    const web = {
      get length() {
        return store.size;
      },
      key(i: number) {
        return Array.from(store.keys())[i] ?? null;
      },
      getItem(k: string) {
        return store.has(k) ? store.get(k)! : null;
      },
      setItem(k: string, v: string) {
        store.set(k, v);
      },
      removeItem(k: string) {
        store.delete(k);
      },
      clear() {
        store.clear();
      },
    } as Storage;

    web.setItem("sb-demo-auth-token", '{"access_token":"a"}');
    web.setItem("sidebar:groups", "{}");

    const prefs = new Map<string, string>();
    const api = {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
        prefs.set(key, value);
      }),
      remove: vi.fn(async ({ key }: { key: string }) => {
        prefs.delete(key);
      }),
    };

    const n1 = await migrateLocalStorageAuthToPreferences(api, web);
    expect(n1).toBe(1);
    expect(prefs.get("sb-demo-auth-token")).toBe('{"access_token":"a"}');
    expect(prefs.get("safenex-auth-prefs-migrated-v1")).toBe("1");
    expect(prefs.has("sidebar:groups")).toBe(false);

    web.setItem("sb-demo-auth-token", '{"access_token":"b"}');
    const n2 = await migrateLocalStorageAuthToPreferences(api, web);
    expect(n2).toBe(0);
    expect(prefs.get("sb-demo-auth-token")).toBe('{"access_token":"a"}');
  });
});
