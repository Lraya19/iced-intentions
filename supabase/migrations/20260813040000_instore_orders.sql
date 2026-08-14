-- ═══════════════════════════════════════════════════════════════
-- In-store orders (scan-to-pay)
-- ───────────────────────────────────────────────────────────────
-- Customers buying at the counter used to earn nothing: stamps are only
-- awarded by process-payment, which only ran for online orders. These
-- orders let them pay on their phone instead and collect the stamp.
--
-- An in-store order differs from a pickup order in three ways:
--   • no pickup slot is reserved (they're already standing there)
--   • the 7 PM next-day cutoff does not apply
--   • it may be created by the barista BEFORE the customer signs in, so
--     user_id starts null and is claimed by whoever pays it
-- ═══════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists order_type text not null default 'pickup';

alter table public.orders
  drop constraint if exists orders_order_type_check;
alter table public.orders
  add constraint orders_order_type_check check (order_type in ('pickup', 'instore'));

-- Barista-created charges are keyed by an unguessable id and shown to the
-- customer as a QR code. The customer is not signed in yet and RLS only
-- lets people read their OWN orders, so they'd be unable to see what
-- they're about to pay for. This returns just enough to render the pay
-- screen — items and money, no customer PII — and only ever for an
-- unpaid in-store order.
create or replace function public.get_payable_order(p_id text)
returns table (id text, items jsonb, subtotal numeric, order_type text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select o.id, o.items, o.subtotal, o.order_type
  from public.orders o
  where o.id = p_id
    and o.order_type = 'instore'
    and o.payment_status <> 'paid';
$function$;

grant execute on function public.get_payable_order(text) to anon, authenticated;

-- In-store orders have no pickup time — the customer is at the counter.
-- The column was NOT NULL from when every order was a scheduled pickup.
alter table public.orders alter column pickup_time drop not null;
