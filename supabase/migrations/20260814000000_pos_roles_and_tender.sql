-- ═══════════════════════════════════════════════════════════════
-- POS: staff roles + cash tender
-- ───────────────────────────────────────────────────────────────
-- admin_emails was all-or-nothing: anyone on it could see every order,
-- read revenue, and pause the storefront. Employees need the till and the
-- board, not the takings and the kill switch.
--
-- am_i_admin() keeps its meaning of "is staff at all", so the existing
-- orders policy covers both roles. Store controls tighten to owners only.
-- ═══════════════════════════════════════════════════════════════

alter table public.admin_emails
  add column if not exists role text not null default 'staff';

alter table public.admin_emails
  drop constraint if exists admin_emails_role_check;
alter table public.admin_emails
  add constraint admin_emails_role_check check (role in ('owner', 'staff'));

-- Everyone already on the list predates the split and had full access;
-- keep it rather than silently demoting them.
update public.admin_emails set role = 'owner' where role = 'staff';

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select role from public.admin_emails where email = auth.email() limit 1;
$function$;

create or replace function public.am_i_owner()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.admin_emails
    where email = auth.email() and role = 'owner'
  );
$function$;

drop policy if exists store_settings_admin_update on public.store_settings;
create policy store_settings_admin_update on public.store_settings
  for update using (public.am_i_owner()) with check (public.am_i_owner());

-- ── Tender ─────────────────────────────────────────────────────
alter table public.orders
  add column if not exists payment_method text,
  add column if not exists settled_by uuid,
  add column if not exists cash_received numeric;

alter table public.orders
  drop constraint if exists orders_payment_method_check;
alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method is null or payment_method in ('card', 'cash'));

alter table public.orders
  drop constraint if exists orders_order_type_check;
alter table public.orders
  add constraint orders_order_type_check
  check (order_type in ('pickup', 'instore', 'pos', 'kiosk'));

grant execute on function public.my_role() to authenticated;
grant execute on function public.am_i_owner() to authenticated;
