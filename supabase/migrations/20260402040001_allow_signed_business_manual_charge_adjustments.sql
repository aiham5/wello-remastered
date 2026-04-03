alter table public.business_manual_charges
  drop constraint if exists business_manual_charges_amount_cents_check;

alter table public.business_manual_charges
  add constraint business_manual_charges_amount_cents_check
  check (amount_cents <> 0);
