// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Transactional email (Resend)
// ───────────────────────────────────────────────────────────────
// Replaces EmailJS. Two reasons this lives server-side:
//
//   1. Volume. EmailJS free was 200 emails/month — about 50 orders once
//      you count the owner ticket and the customer confirmation.
//   2. The EmailJS public key shipped inside the browser bundle, so anyone
//      could scrape it and burn the quota. The Resend key lives in Supabase
//      secrets and never leaves the server.
//
// ── NOT AN OPEN RELAY ──────────────────────────────────────────
// This function is callable without a login, because guests place orders
// and submit event enquiries. It is therefore VERY deliberate about what
// it accepts: only { kind, id }. It will not take a recipient, a subject,
// or a body from the caller. It loads the row itself and composes the mail
// from that, so the only address it can ever send to is the one already
// stored on a real order/event — plus the owner.
//
// `confirmation_sent_at` then makes it single-shot, so a replayed id can't
// be used to flood a customer on our sending reputation.
//
// Deploy:  supabase functions deploy send-email
// Secrets: RESEND_API_KEY, RESEND_FROM, OWNER_EMAIL
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const money = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface Message {
  to: string;
  subject: string;
  heading: string;
  body: string;
  footer?: string;
  replyTo?: string;
}

// Brand-consistent shell. `body` is pre-escaped plain text rendered in a
// <pre> so the line breaks we compose actually survive.
function renderHtml(m: Message): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#FAF1E4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFEFA;border:1px solid rgba(92,58,33,0.12);border-radius:12px;">
    <tr><td style="padding:28px 30px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#2A1810;font-style:italic;margin-bottom:4px;">Iced Intentions</div>
      <div style="height:1px;background:rgba(92,58,33,0.15);margin:14px 0 20px 0;"></div>
      <h1 style="font-family:Georgia,serif;font-size:21px;color:#2A1810;margin:0 0 14px 0;font-weight:600;">${esc(m.heading)}</h1>
      <pre style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#3D2817;white-space:pre-wrap;word-wrap:break-word;margin:0;">${esc(m.body)}</pre>
      ${m.footer ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#5C3A21;margin:22px 0 0 0;padding-top:16px;border-top:1px solid rgba(92,58,33,0.12);">${esc(m.footer)}</p>` : ""}
    </td></tr>
  </table>
</body></html>`;
}

async function sendViaResend(apiKey: string, from: string, m: Message) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [m.to],
      subject: m.subject,
      html: renderHtml(m),
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend ${res.status}: ${detail}`);
  }
  return await res.json();
}

// ── Message composition ────────────────────────────────────────

function orderMessages(order: any, ownerEmail: string): Message[] {
  const items = (order.items ?? []) as any[];
  const itemLines = items.map((i) => {
    const size = i.sizeDisplay || (i.size === "L" ? "Large" : "Bucket");
    const notes = i.notes ? ` — "${i.notes}"` : "";
    return `${i.qty}× ${i.name} (${size})${notes} — ${money(i.lineTotal)}`;
  }).join("\n");

  const customer = order.customer ?? {};
  const shortId = String(order.id).slice(-8).toUpperCase();
  const paid = order.payment_status === "paid";
  const firstName = String(customer.name || "there").split(" ")[0];

  // Money breakdown, shown on both copies so the customer has a real
  // receipt and the owner has filing-ready figures.
  const hasBreakdown = order.tax != null && Number(order.tax) > 0;
  const breakdown = hasBreakdown
    ? [
      `Subtotal: ${money(Number(order.subtotal ?? 0) - Number(order.discount ?? 0))}`,
      `Sales tax: ${money(order.tax)}`,
    ]
    : [];

  const msgs: Message[] = [{
    to: ownerEmail,
    replyTo: customer.email || undefined,
    subject: `New order · ${order.pickup_time_display || order.pickup_time} · ${customer.name || "Guest"}`,
    heading: `Order ${shortId}`,
    body: [
      `PICKUP: ${order.pickup_date} at ${order.pickup_time_display || order.pickup_time}`,
      "",
      itemLines,
      "",
      ...(Number(order.discount) > 0 ? [`Reward discount: -${money(order.discount)}`] : []),
      ...breakdown,
      `TOTAL ${paid ? "PAID" : "DUE"}: ${money(order.total)}`,
      "",
      `Customer: ${customer.name || "(not provided)"}`,
      `Phone:    ${customer.phone || "(not provided)"}`,
      `Email:    ${customer.email || "(not provided)"}`,
      order.square_receipt_url ? `Receipt:  ${order.square_receipt_url}` : null,
    ].filter(Boolean).join("\n"),
    footer: paid
      ? "Paid online — hand it over at pickup."
      : "⚠️ NOT PAID. Do not make this order until payment clears.",
  }];

  if (customer.email) {
    msgs.push({
      to: customer.email,
      subject: "Your Iced Intentions order is confirmed ☕",
      heading: `Thank you, ${firstName}!`,
      body: [
        "Your order is in and we'll have it ready right at your pickup time.",
        "",
        `PICKUP: ${order.pickup_date} at ${order.pickup_time_display || order.pickup_time}`,
        `ORDER:  ${shortId}`,
        "",
        itemLines,
        "",
        ...(Number(order.discount) > 0 ? [`Free drink reward: -${money(order.discount)}`] : []),
        ...breakdown,
        `Total paid: ${money(order.total)}`,
        "",
        order.square_receipt_url ? `Your receipt: ${order.square_receipt_url}` : null,
      ].filter(Boolean).join("\n"),
      footer: "See you soon — made with mucho amor. 🤍",
    });
  }

  return msgs;
}

function eventMessages(ev: any, ownerEmail: string): Message[] {
  const firstName = String(ev.customer_name || "there").split(" ")[0];

  const msgs: Message[] = [{
    to: ownerEmail,
    replyTo: ev.customer_email || undefined,
    subject: `Event inquiry · ${ev.event_type} · ${ev.date}`,
    heading: "New event inquiry",
    body: [
      `TYPE:     ${ev.event_type}`,
      `DATE:     ${ev.date} at ${ev.start_time}`,
      `DURATION: ${ev.duration} hrs`,
      `GUESTS:   ${ev.guests || "(not provided)"}`,
      "",
      `Name:  ${ev.customer_name}`,
      `Email: ${ev.customer_email}`,
      `Phone: ${ev.customer_phone}`,
      "",
      `Notes: ${ev.notes || "(none)"}`,
      "",
      `Reference: ${ev.booking_id}`,
    ].join("\n"),
    footer: "Reply within 24 hours — that's what the site promises them.",
  }];

  if (ev.customer_email) {
    msgs.push({
      to: ev.customer_email,
      subject: "We got your Iced Intentions event inquiry ✨",
      heading: `Thank you, ${firstName}!`,
      body: [
        "We've received your inquiry and we'll be in touch within 24 hours.",
        "",
        `TYPE:   ${ev.event_type}`,
        `DATE:   ${ev.date} at ${ev.start_time}`,
        `GUESTS: ${ev.guests || "to be confirmed"}`,
        "",
        "We've pencilled your date in while we talk it through.",
      ].join("\n"),
      footer: "Can't wait to hear more about your day. 🤍",
    });
  }

  return msgs;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Iced Intentions <onboarding@resend.dev>";
    const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!RESEND_API_KEY || !OWNER_EMAIL) {
      console.error("send-email is not configured (RESEND_API_KEY / OWNER_EMAIL missing)");
      return json({ error: "Email is not configured." }, 500);
    }

    const { kind, id } = await req.json() as { kind?: string; id?: string };
    if (!id || typeof id !== "string" || (kind !== "order" && kind !== "event")) {
      return json({ error: "Bad request." }, 400);
    }

    const table = kind === "order" ? "orders" : "events";
    const idColumn = kind === "order" ? "id" : "booking_id";

    const { data: row, error: readErr } = await supabase
      .from(table)
      .select("*")
      .eq(idColumn, id)
      .maybeSingle();

    if (readErr) {
      console.error("Row lookup failed:", readErr.message);
      return json({ error: "Could not load that record." }, 500);
    }
    if (!row) {
      return json({ error: "Not found." }, 404);
    }

    // Single-shot: a replayed id must not be able to re-send.
    if (row.confirmation_sent_at) {
      return json({ ok: true, alreadySent: true }, 200);
    }

    // Claim it BEFORE sending. Two concurrent calls race here, and the loser
    // sees zero updated rows and bails — better a missed duplicate than a
    // double send.
    const { data: claimed, error: claimErr } = await supabase
      .from(table)
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq(idColumn, id)
      .is("confirmation_sent_at", null)
      .select(idColumn);

    if (claimErr) {
      console.error("Claim failed:", claimErr.message);
      return json({ error: "Could not send right now." }, 500);
    }
    if (!claimed || claimed.length === 0) {
      return json({ ok: true, alreadySent: true }, 200);
    }

    const messages = kind === "order"
      ? orderMessages(row, OWNER_EMAIL)
      : eventMessages(row, OWNER_EMAIL);

    // One failure must not suppress the others — the owner's ticket matters
    // even if the customer's address bounces.
    const results = await Promise.allSettled(
      messages.map((m) => sendViaResend(RESEND_API_KEY, RESEND_FROM, m)),
    );
    const failed = results.filter((r) => r.status === "rejected");
    failed.forEach((f) => console.error("Resend send failed:", (f as PromiseRejectedResult).reason));

    // If every message failed, release the claim so a retry can work.
    if (failed.length === messages.length) {
      await supabase.from(table).update({ confirmation_sent_at: null }).eq(idColumn, id);
      return json({ error: "Could not send email." }, 502);
    }

    return json({ ok: true, sent: messages.length - failed.length, failed: failed.length }, 200);
  } catch (err) {
    console.error("Unexpected error in send-email:", err);
    return json({ error: "Something went wrong sending email." }, 500);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
