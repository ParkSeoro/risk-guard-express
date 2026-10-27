/**
 * Supabase browser client — session persists in localStorage (web + native).
 * Preferences bridge is disabled for now (OTA download could wedge login).
 * Do not switch storage to sessionStorage; closing the app must keep the session.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { createAuthStorage } from '@/lib/native/authStorage';

const DEFAULT_SUPABASE_URL = 'https://qhntxmggacorqjjmjqgo.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_2L5XwiIgCQvfZTm6GcFtlA_k3cRr-sX';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || DEFAULT_SUPABASE_KEY;

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
