// ─────────────────────────────────────────────────────
// Storage Layer
// ─────────────────────────────────────────────────────
// Abstracts away whether we're using Supabase (production)
// or localStorage (local dev fallback). The rest of the app
// shouldn't care which one is active.

import { supabase, isSupabaseConfigured } from './supabase';

// ─── ORDER TIME SLOTS ──────────────────────────────────────
// Table: slots(date primary key, booked_times jsonb, updated_at timestamptz)
// booked_times shape: { "09:00": { customer: "...", ts: <unix> } }

export const subscribeToSlots = (date, callback) => {
  if (isSupabaseConfigured && supabase) {
    let active = true;

    // Initial load
    supabase
      .from('slots')
      .select('booked_times')
      .eq('date', date)
      .maybeSingle()
      .then(({ data }) => {
        if (active) callback(data?.booked_times || {});
      });

    // Real-time subscription — callback fires whenever this row changes
    const channel = supabase
      .channel(`slots:${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slots', filter: `date=eq.${date}` },
        (payload) => {
          if (!active) return;
          const next = payload.new?.booked_times || {};
          callback(next);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }

  // localStorage fallback
  const read = () => {
    try {
      const raw = localStorage.getItem(`slots:${date}`);
      callback(raw ? JSON.parse(raw) : {});
    } catch {
      callback({});
    }
  };
  read();
  const handler = (e) => { if (e.key === `slots:${date}`) read(); };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
};

// Atomic booking — uses a Postgres function with row locking so two
// customers can't grab the same slot at the same instant
export const bookSlot = async (date, time, customerName) => {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc('book_slot', {
      p_date: date,
      p_time: time,
      p_customer: customerName,
    });
    if (error) {
      // The function raises 'SLOT_TAKEN' which arrives as a Postgres error
      if (error.message?.includes('SLOT_TAKEN')) {
        throw new Error('SLOT_TAKEN');
      }
      throw error;
    }
    return true;
  }

  // localStorage fallback (no real concurrency, but works locally)
  const raw = localStorage.getItem(`slots:${date}`);
  const slots = raw ? JSON.parse(raw) : {};
  if (slots[time]) throw new Error('SLOT_TAKEN');
  slots[time] = { customer: customerName, ts: Date.now() };
  localStorage.setItem(`slots:${date}`, JSON.stringify(slots));
  return true;
};

// ─── EVENT BOOKINGS ─────────────────────────────────────────
// Table: events — one row per date. We just expose the date column to clients.

export const subscribeToEventDates = (callback) => {
  if (isSupabaseConfigured && supabase) {
    let active = true;

    const refresh = async () => {
      const { data } = await supabase.from('events').select('date');
      if (!active) return;
      const dates = {};
      (data || []).forEach((e) => { dates[e.date] = true; });
      callback(dates);
    };

    refresh();

    const channel = supabase
      .channel('events_dates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events' },
        refresh
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }

  // localStorage fallback
  const read = () => {
    try {
      const raw = localStorage.getItem('eventDates');
      callback(raw ? JSON.parse(raw) : {});
    } catch {
      callback({});
    }
  };
  read();
  const handler = (e) => { if (e.key === 'eventDates') read(); };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
};

export const bookEvent = async (date, booking) => {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc('book_event', {
      p_date: date,
      p_booking: booking,
    });
    if (error) {
      if (error.message?.includes('DATE_TAKEN')) {
        throw new Error('DATE_TAKEN');
      }
      throw error;
    }
    return true;
  }

  // localStorage fallback
  const raw = localStorage.getItem('eventDates');
  const dates = raw ? JSON.parse(raw) : {};
  if (dates[date]) throw new Error('DATE_TAKEN');
  dates[date] = true;
  localStorage.setItem('eventDates', JSON.stringify(dates));
  localStorage.setItem(`event:${date}`, JSON.stringify(booking));
  return true;
};

// ─── ORDER HISTORY ──────────────────────────────────────────
// Table: orders — write-only for the public site. Owner reads via dashboard.

export const saveOrder = async (orderId, order) => {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from('orders').insert({
      id: orderId,
      pickup_date: order.pickupDate,
      pickup_time: order.pickupTime,
      pickup_time_display: order.pickupTimeDisplay,
      customer: order.customer,
      items: order.items,
      total: order.total,
    });
    if (error) throw error;
    return true;
  }
  localStorage.setItem(`order:${orderId}`, JSON.stringify(order));
  return true;
};
