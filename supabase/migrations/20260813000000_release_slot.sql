-- ═══════════════════════════════════════════════════════════════
-- release_slot(p_date, p_time)
-- ───────────────────────────────────────────────────────────────
-- The inverse of book_slot. The checkout flow books a pickup slot BEFORE
-- charging the card, so that we never take money for a slot that's already
-- gone. The cost of that ordering is that a DECLINED card would otherwise
-- leave the slot permanently consumed — two failed attempts and the
-- customer is locked out of the very time they were trying to book.
--
-- process-payment calls this (as service role) whenever a charge fails, so
-- the spot goes straight back on sale.
--
-- Mirrors book_slot's conventions, including tolerating legacy rows where
-- booked_times stored a customer NAME string rather than a count.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.release_slot(p_date text, p_time text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_slots jsonb;
  cur_count int;
begin
  select booked_times into current_slots
  from public.slots
  where date = p_date
  for update;

  if current_slots is null then
    return;
  end if;

  cur_count := case
    when current_slots ? p_time then
      case jsonb_typeof(current_slots -> p_time)
        when 'number' then (current_slots ->> p_time)::int
        else 1
      end
    else 0
  end;

  if cur_count <= 0 then
    return;
  end if;

  if cur_count = 1 then
    -- Last holder released: drop the key entirely so the slot reads as free.
    update public.slots
    set booked_times = current_slots - p_time,
        updated_at = now()
    where date = p_date;
  else
    update public.slots
    set booked_times = jsonb_set(current_slots, array[p_time], to_jsonb(cur_count - 1)),
        updated_at = now()
    where date = p_date;
  end if;
end;
$function$;

-- Only the service role (i.e. the Edge Function) may release a slot.
-- If the browser could call this, anyone could free up other people's
-- bookings at will.
revoke all on function public.release_slot(text, text) from public;
revoke all on function public.release_slot(text, text) from anon;
revoke all on function public.release_slot(text, text) from authenticated;
