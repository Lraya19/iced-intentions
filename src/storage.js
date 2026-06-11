// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Storage layer
// ───────────────────────────────────────────────────────────────
// Wraps Supabase for slots, events, and orders. Falls back to
// localStorage when Supabase env vars are missing (local dev).
//
// Schema notes:
//  - slots:  date (text), booked_times (jsonb { "09:00": "Name", ... }), updated_at
//  - events: date (text PK), event_type, start_time, duration, guests,
//            customer_name/email/phone, notes, booking_id, created_at
//  - orders: id (text PK), pickup_date, pickup_time, pickup_time_display,
//            customer (jsonb), items (jsonb), total, created_at,
//            payment_status, square_payment_id, square_receipt_url
//  - RPCs:   book_slot(p_date, p_time, p_customer), book_event(p_date, p_booking)
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
    if (all[date][slotTime]) throw new Error('SLOT_TAKEN');
    all[date][slotTime] = customerName || 'Booked';
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
// EVENTS
// ═══════════════════════════════════════════════════════

export function subscribeToEventDates(cb) {
  if (!isSupabaseConfigured) {
    const all = LS.get('ii_events', {});
    cb(all);
    const handler = () => cb(LS.get('ii_events', {}));
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }

  const fetchDates = async () => {
    const { data, error } = await supabase.from('events').select('date');
    if (error) { console.warn('Event fetch error:', error.message); return; }
    const map = {};
    (data || []).forEach((row) => { map[row.date] = true; });
    cb(map);
  };
  fetchDates();

  const channel = supabase
    .channel('events-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => fetchDates())
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// Book an event date. Throws Error('DATE_TAKEN') if taken.
export async function bookEvent(date, booking) {
  if (!isSupabaseConfigured) {
    const all = LS.get('ii_events', {});
    if (all[date]) throw new Error('DATE_TAKEN');
    all[date] = booking;
    LS.set('ii_events', all);
    return;
  }

  const { error } = await supabase.rpc('book_event', {
    p_date: date,
    p_booking: booking,
  });

  if (error) {
    if (error.message && error.message.includes('DATE_TAKEN')) {
      throw new Error('DATE_TAKEN');
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════

// Save an order. Maps the order object to the orders table columns,
// including the payment fields (nullable — safe for pay-at-pickup).
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
    pickup_date: order.pickupDate,
    pickup_time: order.pickupTime,
    pickup_time_display: order.pickupTimeDisplay || null,
    customer: order.customer,
    items: order.items,
    total: order.total,
    payment_status: order.paymentStatus || 'unpaid',
    square_payment_id: order.squarePaymentId || null,
    square_receipt_url: order.squareReceiptUrl || null,
  };

  // INSERT only — the orders table RLS allows public INSERT but not UPDATE.
  // For online payments, the row is inserted once as 'pending', then the
  // Edge Function (service role) updates it to 'paid' server-side.
  const { error } = await supabase.from('orders').insert(row);
  if (error) throw error;
}
