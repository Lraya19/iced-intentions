// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Loyalty + favorites data access (frontend)
// ───────────────────────────────────────────────────────────────
// Reads the user's stamp balance, ledger history, recent orders, and
// manages saved favorites. All reads are protected by Row-Level
// Security: a user can only ever see their own rows. Stamp WRITES
// happen server-side in the payment Edge Function, never here.
// ═══════════════════════════════════════════════════════════════

import { supabase, isSupabaseConfigured } from './supabase';

export const STAMPS_FOR_REWARD = 10;

// Current stamp balance = sum of the user's ledger deltas.
// We read the ledger directly (RLS-protected) and sum client-side,
// rather than calling the locked-down loyalty_balance() function.
export async function getLoyaltyBalance(userId) {
  if (!isSupabaseConfigured || !userId) return 0;
  const { data, error } = await supabase
    .from('loyalty_events')
    .select('delta')
    .eq('user_id', userId);
  if (error) { console.warn('Balance read failed:', error.message); return 0; }
  return (data || []).reduce((sum, row) => sum + (row.delta || 0), 0);
}

// Full loyalty ledger (most recent first) for the history view.
export async function getLoyaltyHistory(userId, limit = 50) {
  if (!isSupabaseConfigured || !userId) return [];
  const { data, error } = await supabase
    .from('loyalty_events')
    .select('id, order_id, delta, reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('History read failed:', error.message); return []; }
  return data || [];
}

// The user's recent orders for the dashboard.
export async function getMyOrders(userId, limit = 20) {
  if (!isSupabaseConfigured || !userId) return [];
  const { data, error } = await supabase
    .from('orders')
    .select('id, pickup_date, pickup_time_display, items, total, payment_status, square_receipt_url, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('Orders read failed:', error.message); return []; }
  return data || [];
}

// ── Favorites ──

export async function getFavorites(userId) {
  if (!isSupabaseConfigured || !userId) return [];
  const { data, error } = await supabase
    .from('favorites')
    .select('id, label, drink, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('Favorites read failed:', error.message); return []; }
  return data || [];
}

// Save a drink customization as a favorite.
// `drink` is the full cart-item snapshot (name, size, addOns, notes, gradient, prices).
export async function addFavorite(userId, drink, label) {
  if (!isSupabaseConfigured || !userId) throw new Error('Please sign in to save favorites.');
  const { data, error } = await supabase
    .from('favorites')
    .insert({ user_id: userId, drink, label: label || drink.name })
    .select()
    .single();
  if (error) throw new Error(error.message || 'Could not save favorite.');
  return data;
}

export async function removeFavorite(userId, favoriteId) {
  if (!isSupabaseConfigured || !userId) return;
  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('id', favoriteId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message || 'Could not remove favorite.');
}
