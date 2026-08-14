// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Owner / admin data access (frontend)
// ───────────────────────────────────────────────────────────────
// Powers the owner dashboard: checking admin status, reading the
// day's orders, marking orders fulfilled, and controlling the
// storefront (pause ordering + per-drink sold-out). Every write is
// gated by Row-Level Security — only an email in `admin_emails` can
// change orders or store_settings. The browser cannot self-promote.
// ═══════════════════════════════════════════════════════════════

import { supabase, isSupabaseConfigured } from './supabase';

// Is the signed-in user staff at all (owner OR employee)? Calls the
// SECURITY DEFINER am_i_admin(), which checks their email against the
// private allowlist.
export async function amIAdmin() {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await supabase.rpc('am_i_admin');
  if (error) { console.warn('admin check failed:', error.message); return false; }
  return data === true;
}

// 'owner' | 'staff' | null.
//
// Owners see takings, analytics, the CSV export and the store kill switch.
// Employees get the till and the order board and nothing else. Note the
// honest limit of this: the split is enforced in the database only for
// store_settings. Staff can read the orders table (they need the board),
// and per-order totals are on it — so hiding the analytics panel from
// them is a matter of not putting revenue in their face, not a hard
// secrecy boundary. Don't hire someone you wouldn't trust with the board.
export async function myRole() {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('my_role');
  if (error) { console.warn('role check failed:', error.message); return null; }
  return data || null;
}

// ── POS ──

// Settle a POS order as cash (staff only, enforced in the RPC).
// Returns { total, change_due }.
export async function settleCash(orderId, cashReceived) {
  if (!isSupabaseConfigured) throw new Error('Not configured');
  const { data, error } = await supabase.rpc('pos_settle_cash', {
    p_id: orderId,
    p_cash_received: cashReceived ?? null,
  });
  if (error) {
    const m = error.message || '';
    if (m.includes('ALREADY_PAID')) throw new Error('That order has already been settled.');
    if (m.includes('NOT_STAFF')) throw new Error('You do not have permission to take payment.');
    if (m.includes('ORDER_NOT_FOUND')) throw new Error('That order no longer exists.');
    throw new Error(m || 'Could not settle the order.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

// ── Store settings (pause + sold-out) ──

export async function getStoreSettings() {
  if (!isSupabaseConfigured) {
    return { ordering_paused: false, pause_message: '', sold_out_drinks: [] };
  }
  const { data, error } = await supabase
    .from('store_settings')
    .select('ordering_paused, pause_message, sold_out_drinks')
    .eq('id', 1)
    .single();
  if (error) {
    console.warn('store settings read failed:', error.message);
    return { ordering_paused: false, pause_message: '', sold_out_drinks: [] };
  }
  return {
    ordering_paused: !!data.ordering_paused,
    pause_message: data.pause_message || '',
    sold_out_drinks: Array.isArray(data.sold_out_drinks) ? data.sold_out_drinks : [],
  };
}

// Patch store settings (admin only; RLS enforces it). Returns the saved row.
export async function updateStoreSettings(patch) {
  if (!isSupabaseConfigured) throw new Error('Not configured');
  const { data, error } = await supabase
    .from('store_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('ordering_paused, pause_message, sold_out_drinks')
    .single();
  if (error) throw error;
  return data;
}

// Live updates: fire `cb` whenever store settings change (any device).
export function subscribeToStoreSettings(cb) {
  if (!isSupabaseConfigured) return () => {};
  const channel = supabase
    .channel('store_settings_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, (payload) => {
      const row = payload.new || {};
      cb({
        ordering_paused: !!row.ordering_paused,
        pause_message: row.pause_message || '',
        sold_out_drinks: Array.isArray(row.sold_out_drinks) ? row.sold_out_drinks : [],
      });
    })
    .subscribe();
  return () => { try { supabase.removeChannel(channel); } catch (e) { /* noop */ } };
}

// ── Orders (admin reads ALL via the orders_admin_all policy) ──

// Orders for a given pickup date (YYYY-MM-DD), pickup-time order.
export async function getOrdersForDate(dateStr) {
  if (!isSupabaseConfigured || !dateStr) return [];
  const { data, error } = await supabase
    .from('orders')
    .select('id, pickup_date, pickup_time, pickup_time_display, customer, items, subtotal, discount, tax, total, payment_status, payment_method, order_type, fulfilled, square_receipt_url, created_at')
    .eq('pickup_date', dateStr)
    .order('pickup_time', { ascending: true });
  if (error) { console.warn('orders read failed:', error.message); return []; }
  return data || [];
}

// Every PAID order in a pickup-date range, for the analytics panel and
// the CSV export. Admin-only via the orders_admin_all policy.
// `startIso`/`endIso` are inclusive YYYY-MM-DD pickup dates.
export async function getOrdersInRange(startIso, endIso) {
  if (!isSupabaseConfigured || !startIso || !endIso) return [];
  const { data, error } = await supabase
    .from('orders')
    .select('id, pickup_date, pickup_time, pickup_time_display, customer, items, subtotal, discount, tax, total, payment_status, payment_method, order_type, fulfilled, square_payment_id, user_id, created_at')
    .gte('pickup_date', startIso)
    .lte('pickup_date', endIso)
    .eq('payment_status', 'paid')
    .order('pickup_date', { ascending: true })
    .order('pickup_time', { ascending: true });
  if (error) { console.warn('range read failed:', error.message); return []; }
  return data || [];
}

// Mark an order fulfilled / un-fulfilled (admin only; RLS enforced).
export async function setOrderFulfilled(orderId, fulfilled) {
  if (!isSupabaseConfigured) throw new Error('Not configured');
  const { error } = await supabase
    .from('orders')
    .update({ fulfilled })
    .eq('id', orderId);
  if (error) throw error;
  return true;
}

// Payment status of a single order. The POS and kiosk poll this while a
// QR is on screen so the till flips to paid on its own, rather than staff
// having to ask "did that go through?".
export async function getOrderPaymentStatus(orderId) {
  if (!isSupabaseConfigured || !orderId) return null;
  const { data, error } = await supabase
    .from('orders')
    .select('payment_status')
    .eq('id', orderId)
    .maybeSingle();
  if (error) { console.warn('status poll failed:', error.message); return null; }
  return data?.payment_status ?? null;
}

// Live updates for the order board: fire `cb` on any orders change.
export function subscribeToOrders(cb) {
  if (!isSupabaseConfigured) return () => {};
  const channel = supabase
    .channel('orders_board_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => cb())
    .subscribe();
  return () => { try { supabase.removeChannel(channel); } catch (e) { /* noop */ } };
}
