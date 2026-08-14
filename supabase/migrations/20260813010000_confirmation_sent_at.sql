-- ═══════════════════════════════════════════════════════════════
-- confirmation_sent_at
-- ───────────────────────────────────────────────────────────────
-- Idempotency guard for the send-email Edge Function.
--
-- send-email is callable without a login (guests order and enquire), so it
-- deliberately accepts only {kind, id} — never a recipient or a body — and
-- builds the message from the row itself. This column closes the last gap:
-- without it, someone could replay a valid order id in a loop and machine-gun
-- that customer with duplicate confirmations on our sending reputation.
--
-- The function stamps this on the way out and refuses to send twice.
-- ═══════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists confirmation_sent_at timestamptz;

alter table public.events
  add column if not exists confirmation_sent_at timestamptz;
