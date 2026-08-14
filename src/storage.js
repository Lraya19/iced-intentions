// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Storage layer
// ───────────────────────────────────────────────────────────────
// Wraps Supabase for pickup slots and orders. Falls back to
// localStorage when Supabase env vars are missing (local dev).
//
// Schema notes:
//  - slots:  date (text), booked_times (jsonb { "09:00": "Name", ... }), updated_at
//  - orders: id (text PK), pickup_date, pickup_time, pickup_time_display,
//            customer (jsonb), items (jsonb), total, created_at,
//            payment_status, square_payment_id, square_receipt_url
//  - RPCs:   book_slot(p_date, p_time, p_customer)
// ═══════════════════════════════════════════════════════════════

import { supabase, isSupabaseConfigured } from './supabase';

const LS = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
  },
};

// ═══════════════════════════════════════════════════════
// SLOTS
// ═══════════════════════════════════════════════════════

// Subscribe to booked slots for a given date.
// Calls cb({ "09:00": "Name", ... }). Returns an unsubscribe function.
export function subscribeToSlots(date, cb) {
  if (!isSupabaseConfigured) {
    const all = LS.get('ii_slots', {});
    cb(all[date] || {});
    const handler = () => {
      const fresh = LS.get('ii_slots', {});
      cb(fresh[date] || {});
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }

  const fetchSlots = async () => {
    const { data, error } = await supabase
      .from('slots')
      .select('booked_times')
      .eq('date', date)
      .maybeSingle();
    if (error) { console.warn('Slot fetch error:', error.message); return; }
    cb((data && data.booked_times) || {});
  };
  fetchSlots();

  const channel = supabase
    .channel(`slots-${date}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'slots', filter: `date=eq.${date}` },
      () => fetchSlots(),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// Atomically book a slot. Throws Error('SLOT_TAKEN') if already booked.
export async function bookSlot(date, slotTime, customerName) {
  if (!isSupabaseConfigured) {
    const all = LS.get('ii_slots', {});
    all[date] = all[date] || {};
    const cur = typeof all[date][slotTime] === 'number' ? all[date][slotTime] : (all[date][slotTime] ? 1 : 0);
    if (cur >= 2) throw new Error('SLOT_TAKEN');
    all[date][slotTime] = cur + 1;
    LS.set('ii_slots', all);
    return;
  }

  const { error } = await supabase.rpc('book_slot', {
    p_date: date,
    p_time: slotTime,
    p_customer: customerName || 'Booked',
  });

  if (error) {
    if (error.message && error.message.includes('SLOT_TAKEN')) {
      throw new Error('SLOT_TAKEN');
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════

// Read a barista-created in-store charge so the customer can see what
// they're paying for. They aren't signed in yet and RLS only exposes a
// person's own orders, so this goes through a SECURITY DEFINER function
// that returns items + subtotal only — no customer PII, and only ever for
// an unpaid in-store order. Knowing the (unguessable) id is the key.
export async function getPayableOrder(orderId) {
  if (!isSupabaseConfigured || !orderId) return null;
  const { data, error } = await supabase.rpc('get_payable_order', { p_id: orderId });
  if (error) { console.warn('payable order read failed:', error.message); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

// Save an order. Maps the order object to the orders table columns.
// Inserted as 'pending'; process-payment promotes it to 'paid'.
export async function saveOrder(orderId, order) {
  if (!isSupabaseConfigured) {
    const all = LS.get('ii_orders', []);
    const idx = all.findIndex((o) => o.id === orderId);
    if (idx >= 0) all[idx] = order; else all.push(order);
    LS.set('ii_orders', all);
    return;
  }

  const row = {
    id: orderId,
    user_id: order.userId || null,
    order_type: order.orderType || 'pickup',
    pickup_date: order.pickupDate,
    pickup_time: order.pickupTime,
    pickup_time_display: order.pickupTimeDisplay || null,
    customer: order.customer,
    items: order.items,
    subtotal: order.subtotal ?? order.total,
    discount: order.discount ?? 0,
    tax: order.tax ?? 0,
    total: order.total,
    // Orders are always inserted as 'pending'; only the Edge Function
    // (service role) may promote a row to 'paid' after Square confirms.
    payment_status: order.paymentStatus || 'pending',
    square_payment_id: order.squarePaymentId || null,
    square_receipt_url: order.squareReceiptUrl || null,
  };

  // INSERT only — the orders table RLS allows public INSERT but not UPDATE.
  // For online payments, the row is inserted once as 'pending', then the
  // Edge Function (service role) updates it to 'paid' server-side.
  const { error } = await supabase.from('orders').insert(row);
  if (error) throw error;
}
