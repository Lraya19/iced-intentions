// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Auth (magic link via Supabase)
// ───────────────────────────────────────────────────────────────
// Passwordless: the customer enters their email, gets a one-time
// sign-in link, and lands back on the site logged in. No passwords.
// ═══════════════════════════════════════════════════════════════

import { supabase, isSupabaseConfigured } from './supabase';

// Send a magic sign-in link to the given email.
// `fullName` is stored in user metadata on first sign-up so we can
// greet them and prefill checkout.
export async function sendMagicLink(email, fullName) {
  if (!isSupabaseConfigured) {
    throw new Error('Accounts are not available right now.');
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: window.location.origin,
      data: fullName ? { full_name: fullName.trim() } : undefined,
    },
  });
  if (error) throw new Error(error.message || 'Could not send the sign-in link.');
}

// Get the current session's user (or null).
export async function getCurrentUser() {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

// Subscribe to auth state changes. Calls cb(user|null) on every change
// (sign-in, sign-out, token refresh). Returns an unsubscribe function.
export function onAuthChange(cb) {
  if (!isSupabaseConfigured) { cb(null); return () => {}; }
  // Fire once with the current state.
  supabase.auth.getUser().then(({ data }) => cb(data?.user ?? null));
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => sub?.subscription?.unsubscribe?.();
}

export async function signOut() {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
}

// A friendly display name from a user object.
export function displayName(user) {
  if (!user) return '';
  return user.user_metadata?.full_name
    || user.user_metadata?.name
    || (user.email ? user.email.split('@')[0] : 'friend');
}
