// ─────────────────────────────────────────────────────
// Supabase Client
// ─────────────────────────────────────────────────────
// If env vars are present → use Supabase (production behavior).
// If env vars are missing → fall back to localStorage so dev/local works frictionlessly.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

let supabase = null;

if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 10 } },
      // Persist the loyalty/owner login across refreshes; pick up the
      // session from the magic-link redirect automatically.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    console.log('✅ Supabase connected. Real-time slot syncing enabled.');
  } catch (err) {
    console.error('Supabase init failed:', err);
  }
} else {
  console.warn('⚠️ Supabase not configured. Using localStorage fallback (slots will NOT sync between customers). Add VITE_SUPABASE_* env vars to enable production mode.');
}

export { supabase };
