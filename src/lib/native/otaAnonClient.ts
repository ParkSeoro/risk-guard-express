/**
 * Supabase client for OTA release checks / signed download URLs.
 * Must NOT use the app auth storage (Preferences) — a hung session read
 * would wedge the pre-login boot OTA splash forever.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const mem = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => mem.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mem.set(key, value);
  },
  removeItem: (key: string) => {
    mem.delete(key);
  },
};

let client: SupabaseClient | null = null;

export function getOtaAnonClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) {
    throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY for OTA client");
  }
  client = createClient(url, key, {
    auth: {
      storage: memoryStorage,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}
