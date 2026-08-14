-- ═══════════════════════════════════════════════════════════════
-- Retire event bookings
-- ───────────────────────────────────────────────────────────────
-- Event inquiries are no longer taken — the site is drink orders only.
-- The UI is gone, but book_event was still reachable over PostgREST
-- (/rest/v1/rpc/book_event), leaving an open write endpoint into a table
-- nobody monitors any more. Revoke public access to it.
--
-- The `events` table and its historical rows are deliberately KEPT: they
-- are business records of events already delivered. Dropping them is a
-- separate, irreversible decision.
-- ═══════════════════════════════════════════════════════════════

revoke all on function public.book_event(text, jsonb) from public;
revoke all on function public.book_event(text, jsonb) from anon;
revoke all on function public.book_event(text, jsonb) from authenticated;
