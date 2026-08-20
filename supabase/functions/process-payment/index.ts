// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Square Payment + Loyalty Edge Function
// ───────────────────────────────────────────────────────────────
// This is the only thing standing between the menu prices and a customer's
// devtools, so it trusts the client for NOTHING that involves money:
//
//   • The cart total is re-priced here from `items` against PRICES below.
//     The browser does not get to say what it pays.
//   • The loyalty user is taken from the caller's verified JWT, never from
//     a `userId` in the body — otherwise anyone could spend someone else's
//     stamps by passing their id.
//   • The order row must exist and still be unpaid before we charge.
//
// If the charge fails we release the pickup slot and delete the pending
// order row, so a declined card doesn't silently eat one of the two spots
// for that time.
//
// Deploy:  supabase functions deploy process-payment
// Secrets: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_ENV
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SQUARE_HOSTS = {
  sandbox: "https://connect.squareupsandbox.com",
  production: "https://connect.squareup.com",
};

// ── Authoritative price list. Must match MENU in src/App.jsx. ──
const PRICES: Record<string, { L: number; B: number }> = {
  "matcha-verdi": { L: 10.50, B: 19.00 },
  "matcha-besitos": { L: 10.50, B: 19.00 },
  "matcha-blanqui": { L: 10.50, B: 19.00 },
  "matcha-rosa": { L: 10.50, B: 19.00 },
  "dulce-moonkiss": { L: 8.00, B: 15.00 },
  "mornenita-mornings": { L: 8.00, B: 15.00 },
  "nube-blush": { L: 8.00, B: 15.00 },
  "besitos-brunette": { L: 8.00, B: 15.00 },
  "sweet-cielo": { L: 8.00, B: 8.00 },
  "sunkissed-cielo": { L: 8.00, B: 8.00 },
  "coquetta-crush": { L: 8.00, B: 8.00 },
  "summer-chula": { L: 8.00, B: 8.00 },
  "green-chula": { L: 8.00, B: 8.00 },
  "paraiso-fuse": { L: 8.00, B: 12.00 },
  "cremita-fuse": { L: 8.00, B: 12.00 },
  "azulita-fuse": { L: 8.00, B: 12.00 },
  "verde-fuse": { L: 8.00, B: 12.00 },
};

// Must match ADD_ONS in src/App.jsx.
const ADD_ON_PRICES: Record<string, number> = {
  "oatmilk": 0.75,
  "extra-shot": 0.75,
  "chamoy": 0.75,
  "extra-matcha": 1.00,
};

const STAMPS_FOR_REWARD = 10;
const MAX_QTY_PER_LINE = 20;
const MAX_LINES = 40;

// Bakersfield, CA: 7.25% state + 1.00% district. Charged on the
// POST-discount amount — a loyalty reward is a retailer-funded discount,
// which reduces taxable gross receipts, so it reduces the tax too.
// Must match TAX_RATE in src/App.jsx.
const TAX_RATE = 0.0825;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Order cutoff ───────────────────────────────────────────────
// Orders for a pickup day close at 7:00 PM the evening before. Enforced
// here as well as in the UI — a cutoff that only exists in the browser is
// not a cutoff. Edge Functions run in UTC, so all comparisons are done
// against wall-clock time in the shop's own timezone.
const BUSINESS_TZ = "America/Los_Angeles";
const ORDER_CUTOFF_HOUR = 19;

function nowInBusinessTz(): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: BUSINESS_TZ,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  // Some runtimes render midnight as "24" rather than "00".
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

// The calendar day before an ISO date. Date-only UTC arithmetic, so no
// daylight-saving drift.
function previousDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function isPickupDateOrderable(pickupIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupIso)) return false;
  const cutoffDay = previousDay(pickupIso);
  const now = nowInBusinessTz();
  if (now.date < cutoffDay) return true;                                  // more than a day out
  if (now.date === cutoffDay) return now.minutes < ORDER_CUTOFF_HOUR * 60; // cutoff evening
  return false;                                                            // cutoff has passed
}

interface CartItem {
  drinkId: string;
  size: string;
  qty: number;
  addOns?: string[];
}

interface PaymentRequest {
  sourceId?: string;
  orderId: string;
  redeem?: boolean;
  items?: CartItem[];
  buyerEmail?: string;
  pickupDate?: string;
  pickupTime?: string;
  note?: string;
}

function basePrice(drinkId: string, size: string): number {
  const p = PRICES[drinkId];
  if (!p) return 0;
  return String(size).toUpperCase() === "BUCKET" ? p.B : p.L;
}

// Re-price the whole cart from our own numbers. Returns null if the cart
// contains anything we don't recognise — we'd rather refuse the sale than
// charge a made-up amount.
function priceCart(items: CartItem[]): { total: number; cheapest: number } | null {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_LINES) return null;

  let total = 0;
  let cheapest = Infinity;

  for (const it of items) {
    const bp = basePrice(it?.drinkId, it?.size);
    if (bp <= 0) return null; // unknown drink id

    const qty = Number(it?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) return null;

    let addOnTotal = 0;
    for (const id of it?.addOns ?? []) {
      const price = ADD_ON_PRICES[id];
      if (price === undefined) return null; // unknown add-on id
      addOnTotal += price;
    }

    total += (bp + addOnTotal) * qty;
    if (bp < cheapest) cheapest = bp;
  }

  return {
    total: round2(total),
    cheapest: cheapest === Infinity ? 0 : cheapest,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SQUARE_ACCESS_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN");
  const SQUARE_LOCATION_ID = Deno.env.get("SQUARE_LOCATION_ID");
  const SQUARE_ENV = (Deno.env.get("SQUARE_ENV") || "sandbox").toLowerCase();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey);

  // Undo a failed attempt: hand the pickup slot back and bin the pending row.
  // `date`/`time` are null for in-store charges, which reserve no slot —
  // the pending row is still cleaned up.
  async function rollback(orderId: string, date?: string | null, time?: string | null) {
    try {
      if (date && time) {
        const { error } = await supabase.rpc("release_slot", { p_date: date, p_time: time });
        if (error) console.error("release_slot failed:", error.message);
      }
      await supabase.from("orders").delete().eq("id", orderId).eq("payment_status", "pending");
    } catch (e) {
      console.error("Rollback failed:", e);
    }
  }

  let orderId = "";
  let pickupDate: string | null = null;
  let pickupTime: string | null = null;

  try {
    if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
      return json({ error: "Payment system is not configured. Please contact us." }, 500);
    }
    const host = SQUARE_HOSTS[SQUARE_ENV as "sandbox" | "production"] || SQUARE_HOSTS.sandbox;

    const body = (await req.json()) as PaymentRequest;
    const { sourceId, redeem, items, buyerEmail, note } = body;
    orderId = typeof body.orderId === "string" ? body.orderId : "";

    if (!orderId) {
      return json({ error: "Missing order reference." }, 400);
    }

    // ── Who is this, really? ──
    // Derive the loyalty user from the bearer token instead of believing a
    // client-supplied id. Guests send the anon key and stay anonymous.
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token && token !== anonKey) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr) {
        console.warn("Token verification failed:", userErr.message);
      } else {
        userId = userData?.user?.id ?? null;
      }
    }

    // ── The order must exist, be ours, and still be unpaid. ──
    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .select("id, payment_status, pickup_date, pickup_time, user_id, order_type, items")
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr) {
      console.error("Order lookup failed:", orderErr.message);
      return json({ error: "Could not verify your order. Please try again." }, 500);
    }
    if (!orderRow) {
      return json({ error: "We couldn't find that order. Please start again." }, 404);
    }
    if (orderRow.payment_status === "paid") {
      return json({ error: "That order has already been paid." }, 409);
    }
    // An order placed while signed in can only be paid by that same account.
    // In-store charges are created by the barista BEFORE the customer signs
    // in, so user_id starts null there and is claimed on payment below.
    if (orderRow.user_id && orderRow.user_id !== userId) {
      return json({ error: "That order belongs to a different account." }, 403);
    }

    const isInStore = orderRow.order_type === "instore" ||
      orderRow.order_type === "pos" || orderRow.order_type === "kiosk";

    if (!isInStore) {
      pickupDate = orderRow.pickup_date ?? body.pickupDate ?? null;
      pickupTime = orderRow.pickup_time ?? body.pickupTime ?? null;
    }

    // ── Cutoff: no ordering for a day once 7 PM the evening before passes. ──
    // Doesn't apply in store: there's no pickup slot to protect and the
    // customer is already at the counter.
    if (!isInStore && (!pickupDate || !isPickupDateOrderable(pickupDate))) {
      await rollback(orderId, pickupDate, pickupTime);
      return json({
        error: "Ordering has closed for that pickup day. Orders must be placed by 7:00 PM the evening before.",
      }, 400);
    }

    // ── Re-price the cart ourselves. The client's numbers are display-only. ──
    // For an in-store charge the authoritative item list is the one the
    // barista saved on the row — the paying phone doesn't get to change it.
    const priceSource = isInStore ? (orderRow.items ?? []) : (items ?? []);
    const priced = priceCart(priceSource as CartItem[]);
    if (!priced) {
      await rollback(orderId, pickupDate, pickupTime);
      return json({ error: "We couldn't price that order. Please rebuild your cart and try again." }, 400);
    }

    // ── Loyalty redemption, verified against the real balance. ──
    let discount = 0;
    let redeeming = false;

    if (redeem && userId) {
      const { data: events, error: balErr } = await supabase
        .from("loyalty_events")
        .select("delta")
        .eq("user_id", userId);
      if (balErr) {
        console.error("Balance check failed:", balErr.message);
        await rollback(orderId, pickupDate, pickupTime);
        return json({ error: "Could not verify your loyalty balance. Please try again." }, 500);
      }
      const balance = (events || []).reduce((s, e) => s + (e.delta || 0), 0);
      if (balance < STAMPS_FOR_REWARD) {
        await rollback(orderId, pickupDate, pickupTime);
        return json({ error: "You don't have enough stamps to redeem yet." }, 400);
      }
      discount = priced.cheapest;
      redeeming = discount > 0;
    }

    // subtotal → less discount → plus tax on what's left = what they pay.
    const subtotal = priced.total;
    const taxable = Math.max(0, round2(subtotal - discount));
    const tax = round2(taxable * TAX_RATE);
    const rawCharge = round2(taxable + tax);
    const chargeCents = Math.round(rawCharge * 100);

    let paymentId: string | null = null;
    let receiptUrl: string | null = null;
    let status = "FREE";

    if (chargeCents > 0) {
      if (!sourceId || typeof sourceId !== "string") {
        await rollback(orderId, pickupDate, pickupTime);
        return json({ error: "Missing card information. Please try again." }, 400);
      }
      const squareRes = await fetch(`${host}/v2/payments`, {
        method: "POST",
        headers: {
          "Square-Version": "2025-01-23",
          "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_id: sourceId,
          idempotency_key: orderId,
          amount_money: { amount: chargeCents, currency: "USD" },
          location_id: SQUARE_LOCATION_ID,
          buyer_email_address: buyerEmail || undefined,
          note: note ? note.slice(0, 500) : `Iced Intentions order ${orderId}`,
        }),
      });
      const squareData = await squareRes.json();
      if (!squareRes.ok) {
        const detail = squareData?.errors?.[0]?.detail ||
          "Your card could not be processed. Please try another card.";
        console.error("Square payment failed:", JSON.stringify(squareData));
        // Give the pickup slot back — the customer will want to retry on it.
        await rollback(orderId, pickupDate, pickupTime);
        return json({ error: detail, squareErrors: squareData?.errors }, 402);
      }
      const payment = squareData.payment;
      paymentId = payment?.id ?? null;
      receiptUrl = payment?.receipt_url ?? null;
      status = payment?.status ?? "UNKNOWN";
    }

    const isPaid = status === "COMPLETED" || status === "APPROVED" || status === "FREE";

    if (!isPaid) {
      // Square accepted the call but didn't complete the payment. Leave the
      // row pending for manual review, but don't hold the slot hostage.
      await supabase
        .from("orders")
        .update({ payment_status: "pending", square_payment_id: paymentId, square_receipt_url: receiptUrl })
        .eq("id", orderId);
      return json({ error: "Your payment didn't complete. Please try again." }, 402);
    }

    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        payment_status: "paid",
        payment_method: "card",
        square_payment_id: paymentId,
        square_receipt_url: receiptUrl,
        subtotal,
        discount,
        tax,
        total: rawCharge,
        // An in-store charge is claimed by whoever actually paid it, so it
        // shows up in their order history alongside the stamp they earned.
        ...(isInStore && userId ? { user_id: userId } : {}),
      })
      .eq("id", orderId);
    if (updateErr) {
      // The money is taken — never fail the request here, just shout in the logs.
      console.error("Order update after successful payment failed:", updateErr.message, { orderId, paymentId });
    }

    if (userId) {
      try {
        if (redeeming) {
          const { error: rErr } = await supabase.rpc("redeem_reward", { p_user: userId, p_order_id: orderId });
          if (rErr) console.error("redeem_reward failed:", rErr.message);
        } else {
          const { error: aErr } = await supabase.rpc("award_stamp", { p_user: userId, p_order_id: orderId });
          if (aErr) console.error("award_stamp failed:", aErr.message);
        }
      } catch (loyErr) {
        console.error("Loyalty update error:", loyErr);
      }
    }

    return json({
      success: true,
      paymentId,
      receiptUrl,
      status,
      amountCharged: rawCharge,
      subtotal,
      discountApplied: discount,
      tax,
      taxRate: TAX_RATE,
      redeemed: redeeming,
    }, 200);
  } catch (err) {
    console.error("Unexpected error in process-payment:", err);
    if (orderId) await rollback(orderId, pickupDate, pickupTime);
    return json({ error: "Something went wrong processing your payment. Please try again." }, 500);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
