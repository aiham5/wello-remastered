alter table public.businesses
  add column if not exists stripe_pending_account_id text;
