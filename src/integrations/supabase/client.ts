/**
 * Supabase browser client — mobile auto-login persists via Preferences on native
 * (SharedPreferences / UserDefaults). Web/PWA still uses localStorage.
 * Do not switch storage to sessionStorage; closing the app must keep the session.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { createAuthStorage } from '@/lib/native/authStorage';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // CI AAB/OTA builds without .env.production used to throw inside createClient
  // before React mounted → permanent white screen on Play Store installs.
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. ' +
      'Production builds must load .env.production (or CI secrets).',
  );
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: createAuthStorage(),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
