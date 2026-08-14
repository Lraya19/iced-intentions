-- ═══════════════════════════════════════════════════════════════
-- Order tax breakdown
-- ───────────────────────────────────────────────────────────────
-- `total` alone is the amount charged, which is useless for filing: it
-- can't tell you how much of a day's takings was sales tax you're holding
-- on the state's behalf. These columns break every order into its parts so
-- the numbers are reportable straight from the table.
--
--   subtotal  — sum of line items, before discount and tax
--   discount  — loyalty reward applied (0 if none)
--   tax       — charged on (subtotal - discount); a retailer-funded
--               discount reduces taxable gross receipts in California
--   total     — what the customer actually paid = subtotal - discount + tax
--
-- Existing rows are backfilled treating their total as tax-inclusive at
-- 8.25%, which is wrong for orders placed before tax was charged at all —
-- see the note below.
-- ═══════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists subtotal numeric,
  add column if not exists discount numeric default 0,
  add column if not exists tax numeric default 0;

-- Historical orders pre-date tax collection: no tax was charged on them,
-- so the honest backfill is subtotal = total, tax = 0. Do NOT retroactively
-- imply tax was collected when it wasn't.
update public.orders
set subtotal = coalesce(subtotal, total),
    discount = coalesce(discount, 0),
    tax      = coalesce(tax, 0)
where subtotal is null;
