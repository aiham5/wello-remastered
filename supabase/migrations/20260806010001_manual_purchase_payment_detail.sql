alter table if exists public.manual_purchase_submissions
  add column if not exists payment_method_detail text;

