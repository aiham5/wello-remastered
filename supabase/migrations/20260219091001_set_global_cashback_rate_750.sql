-- Set global consumer cashback rate to 7.5% (750 bps)
insert into public.app_settings (key, value_json, updated_at)
values (
  'consumer_cashback_rate_bps',
  jsonb_build_object('bps', 750),
  now()
)
on conflict (key)
do update set
  value_json = excluded.value_json,
  updated_at = excluded.updated_at;
