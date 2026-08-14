// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Email triggers
// ───────────────────────────────────────────────────────────────
// Email is sent by the `send-email` Edge Function via Resend. This file
// does nothing but ask it to. (It used to compose and send everything from
// the browser through EmailJS — that capped us at 200 emails/month and
// shipped the sending key inside the public JS bundle.)
//
// Note what is NOT sent from here: no recipient, no subject, no body. The
// function loads the order/event row itself and composes from that, which
// is what stops it being an open relay pointed at our domain. All we pass
// is which record to send for.
//
// Both calls are safe to no-op when Supabase isn't configured, so local
// dev works with no setup.
// ═══════════════════════════════════════════════════════════════

import { isSupabaseConfigured } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function trigger(kind, id) {
  if (!isSupabaseConfigured) {
    console.log(`📧 [Demo Mode] Would send ${kind} email for ${id}`);
    return { sent: false, demoMode: true };
  }
  if (!id) return { sent: false };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ kind, id }),
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail = (await res.json())?.error || detail; } catch { /* ignore */ }
    throw new Error(`Email send failed: ${detail}`);
  }
  return await res.json();
}

// Owner ticket + customer confirmation for a placed order.
export const sendOrderEmails = (order) => trigger('order', order?.id);

// Owner inquiry + customer acknowledgement for an event booking.
export const sendEventEmails = (booking) => trigger('event', booking?.id);
