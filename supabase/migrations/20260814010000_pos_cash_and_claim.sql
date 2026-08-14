-- ═══════════════════════════════════════════════════════════════
-- POS: cash settlement + stamp claiming
-- ═══════════════════════════════════════════════════════════════

-- Settle a POS order as cash. Staff only. No processor involved — this is
-- money in the drawer, so it's recorded rather than charged.
-- Prices are NOT taken from the caller: the row's own totals stand, so a
-- tampered client can't mark a $19 order settled for $1.
create or replace function public.pos_settle_cash(p_id text, p_cash_received numeric default null)
returns table (id text, total numeric, change_due numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.orders%rowtype;
begin
  if not public.am_i_admin() then
    raise exception 'NOT_STAFF';
  end if;

  select * into o from public.orders where public.orders.id = p_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if o.payment_status = 'paid' then
    raise exception 'ALREADY_PAID';
  end if;

  update public.orders
  set payment_status = 'paid',
      payment_method = 'cash',
      settled_by     = auth.uid(),
      cash_received  = p_cash_received
  where public.orders.id = p_id;

  return query
  select o.id, o.total,
         case when p_cash_received is null then null
              else round(p_cash_received - o.total, 2) end;
end;
$function$;

-- Claim a stamp for an already-paid, unclaimed counter sale.
-- Cash customers have no account attached at the till, so they'd otherwise
-- miss the stamp entirely. Staff show a QR, the customer signs in and
-- claims it. Only ever attaches an order that nobody owns yet.
create or replace function public.claim_order(p_id text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select * into o from public.orders where public.orders.id = p_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if o.payment_status <> 'paid' then
    raise exception 'NOT_PAID';
  end if;
  if o.user_id is not null then
    raise exception 'ALREADY_CLAIMED';
  end if;
  if o.order_type not in ('pos', 'kiosk', 'instore') then
    raise exception 'NOT_CLAIMABLE';
  end if;

  update public.orders set user_id = auth.uid() where public.orders.id = p_id;
  perform public.award_stamp(auth.uid(), p_id);
  return true;
end;
$function$;

revoke all on function public.pos_settle_cash(text, numeric) from public, anon;
grant execute on function public.pos_settle_cash(text, numeric) to authenticated;
revoke all on function public.claim_order(text) from public, anon;
grant execute on function public.claim_order(text) to authenticated;
