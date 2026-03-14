create or replace function public.resolve_business_receipt_charge_rate_cents(
  p_commission_rate_cents integer
)
returns integer
language sql
immutable
set search_path = public
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
set search_path = public
as $$
  select case
    when coalesce(p_commission_rate_cents, 150) = 200 then 1500
    else 1000
  end;
$$;
