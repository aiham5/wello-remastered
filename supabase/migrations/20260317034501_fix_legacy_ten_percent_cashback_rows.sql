update public.businesses
set default_cashback_rate_bps = 600
where commission_rate_cents = 100
  and coalesce(default_cashback_rate_bps, 1000) = 1000;
