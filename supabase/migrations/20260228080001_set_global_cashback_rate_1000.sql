-- Set global consumer cashback rate to 10% (1000 bps).

insert into public.app_settings (key, value_json)
values (
  'consumer_cashback_rate_bps',
  jsonb_build_object('bps', 1000)
)
on conflict (key) do update
set value_json = excluded.value_json,
    updated_at = timezone('utc', now());

create or replace function public.get_current_cashback_rate_bps()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_json jsonb;
  v_bps integer;
begin
  select value_json
    into v_json
    from public.app_settings
   where key = 'consumer_cashback_rate_bps';

  if v_json is not null
     and (v_json ? 'bps')
     and coalesce(v_json->>'bps', '') ~ '^[0-9]+$' then
    v_bps := (v_json->>'bps')::integer;
  end if;

  if v_bps is null or v_bps < 10 or v_bps > 5000 then
    return 1000;
  end if;

  return v_bps;
exception
  when others then
    return 1000;
end;
$$;

grant execute on function public.get_current_cashback_rate_bps() to anon, authenticated, service_role;
