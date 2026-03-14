-- Charge the full business commission tier while keeping consumer cashback
-- at a 5-point spread below the configured business tier.
-- 15% plan -> 15% commission / 10% default cashback
-- 20% plan -> 20% commission / 15% default cashback

create or replace function public.resolve_business_receipt_charge_rate_cents(
  p_commission_rate_cents integer
)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_commission_rate_cents, 150) = 200 then 200
    else 150
  end;
$$;

create or replace function public.resolve_business_default_cashback_rate_bps(
  p_commission_rate_cents integer
)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_commission_rate_cents, 150) = 200 then 1500
    else 1000
  end;
$$;

update public.receipt_uploads ru
set commission_due_cents = floor(
  (ru.receipt_total_cents::numeric) *
  ((public.resolve_business_receipt_charge_rate_cents(b.commission_rate_cents) * 10)::numeric) /
  10000
)::integer
from public.businesses b
where ru.business_id = b.id
  and coalesce(ru.receipt_total_cents, 0) > 0
  and coalesce(ru.commission_due_cents, -1) is distinct from floor(
    (ru.receipt_total_cents::numeric) *
    ((public.resolve_business_receipt_charge_rate_cents(b.commission_rate_cents) * 10)::numeric) /
    10000
  )::integer;
