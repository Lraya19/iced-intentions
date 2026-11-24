-- ═══════════════════════════════════════════════════════════════
-- Pickup schedule + private pickup address
-- ───────────────────────────────────────────────────────────────
-- The pickup days, their hours and the order cutoff used to be constants
-- compiled into the site and the process-payment function. Changing them
-- meant a code change — no good for a one-off holiday opening. They now
-- live here and are edited from the owner dashboard.
--
-- pickup_schedule shape (validated/normalised by
-- supabase/functions/_shared/pickup-schedule.js on every read):
--   {
--     "weekdays":    { "1": {"start":"06:00","end":"09:00"}, ... }   0=Sun … 6=Sat
--     "cutoff":      { "daysBefore": 1, "time": "17:00" }            Pacific time
--     "specialDays": [{ "date":"2026-11-26", "open":true,
--                       "start":"06:00", "end":"09:00", "label":"Thanksgiving Day" }]
--   }
--
-- It sits on store_settings, which is public-read on purpose: the checkout
-- has to know which days to offer. The pickup ADDRESS does not belong
-- there — it's only revealed once someone has paid — so it gets its own
-- table whose RLS lets nobody but staff read it. The Edge Functions read
-- it with the service role and hand it over after a successful charge.
--
-- Purely additive: nothing is dropped, revoked or overwritten.
-- ═══════════════════════════════════════════════════════════════

-- ── Schedule ───────────────────────────────────────────────────
-- Adding the column with this value fills the existing settings row:
-- Mondays and Fridays from now on, orders closing 5 PM the day before,
-- plus a one-off Thanksgiving Day opening (Thu 26 Nov 2026).
alter table public.store_settings
  add column pickup_schedule jsonb not null default '{
    "weekdays": { "1": {"start":"06:00","end":"09:00"}, "5": {"start":"06:00","end":"09:00"} },
    "cutoff": { "daysBefore": 1, "time": "17:00" },
    "specialDays": [
      { "date": "2026-11-26", "open": true, "start": "06:00", "end": "09:00", "label": "Thanksgiving Day" }
    ]
  }'::jsonb
  constraint store_settings_pickup_schedule_shape check (jsonb_typeof(pickup_schedule) = 'object');

-- …but the one-off Thanksgiving opening is not a sensible default going forward.
alter table public.store_settings
  alter column pickup_schedule set default '{
    "weekdays": { "1": {"start":"06:00","end":"09:00"}, "5": {"start":"06:00","end":"09:00"} },
    "cutoff": { "daysBefore": 1, "time": "17:00" },
    "specialDays": []
  }'::jsonb;

-- ── Private settings (pickup address) ──────────────────────────
create table public.private_settings (
  id smallint primary key default 1 check (id = 1),
  pickup_address text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.private_settings enable row level security;

-- Staff can see it (they work there); only owners can change it. There is
-- no policy for anyone else, so anonymous and ordinary signed-in users get
-- zero rows. No insert/delete policies: the single row is created here.
create policy private_settings_staff_read on public.private_settings
  for select using (public.am_i_admin());

create policy private_settings_owner_update on public.private_settings
  for update using (public.am_i_owner()) with check (public.am_i_owner());

-- The address itself is deliberately NOT in this file: the repository is
-- public, and the whole point of this table is that the address isn't.
-- The row is created blank here; the real address is set from the owner
-- dashboard (Pickup schedule → Pickup address). In production it was
-- filled in when this migration was applied.
insert into public.private_settings (id, pickup_address)
values (1, '');
