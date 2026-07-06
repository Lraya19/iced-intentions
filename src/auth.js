// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Auth (email one-time CODE via Supabase)
// ───────────────────────────────────────────────────────────────
// Passwordless: the customer enters their email, receives a 6-digit
// code, types it back into the site, and is signed in ON THE SPOT —
// no page reload, no jumping to a new tab. No passwords.
// ═══════════════════════════════════════════════════════════════

import { supabase, isSupabaseConfigured } from './supabase';

// Send a one-time sign-in CODE to the given email.
// `fullName` is stored in user metadata on first sign-up so we can
// greet them and prefill checkout. shouldCreateUser=true means the
// same flow works whether they're new or returning.
export async function sendLoginCode(email, fullName) {
  if (!isSupabaseConfigured) {
    throw new Error('Accounts are not available right now.');
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      shouldCreateUser: true,
      data: fullName ? { full_name: fullName.trim() } : undefined,
    },
  });
  if (error) throw new Error(error.message || 'Could not send your code.');
}

// Verify the 6-digit code and establish the session immediately.
export async function verifyLoginCode(email, token) {
  if (!isSupabaseConfigured) {
    throw new Error('Accounts are not available right now.');
  }
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: String(token).trim(),
    type: 'email',
  });
  if (error) {
    // Friendlier message for the common wrong/expired case.
    const m = (error.message || '').toLowerCase();
    if (m.includes('expired') || m.includes('invalid') || m.includes('token')) {
      throw new Error('That code didn\'t work. Double-check it or request a new one.');
    }
    throw new Error(error.message || 'Could not verify your code.');
  }
  return data?.user ?? null;
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
