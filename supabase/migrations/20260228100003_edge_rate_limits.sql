-- Shared edge-function rate limiter for abuse/cost control.
-- Safe to run multiple times.

create table if not exists public.edge_rate_limit_counters (
  scope text not null check (char_length(scope) between 1 and 80),
  identifier_hash text not null check (char_length(identifier_hash) = 32),
  window_seconds integer not null check (window_seconds between 1 and 86400),
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, identifier_hash, window_seconds, window_started_at)
);

create index if not exists edge_rate_limit_counters_updated_idx
  on public.edge_rate_limit_counters(updated_at desc);

drop trigger if exists set_edge_rate_limit_counters_updated_at on public.edge_rate_limit_counters;
create trigger set_edge_rate_limit_counters_updated_at
before update on public.edge_rate_limit_counters
for each row execute function public.set_updated_at();

alter table public.edge_rate_limit_counters enable row level security;
revoke all on table public.edge_rate_limit_counters from anon, authenticated;
grant all on table public.edge_rate_limit_counters to service_role;

create or replace function public.consume_edge_rate_limit(
  p_scope text,
  p_identifier text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer,
  reset_at timestamptz,
  current_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_identifier text := lower(trim(coalesce(p_identifier, '')));
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds, 60), 86400));
  v_max_requests integer := greatest(1, least(coalesce(p_max_requests, 30), 10000));
  v_identifier_hash text;
  v_now timestamptz := now();
  v_window_started_at timestamptz;
  v_reset_at timestamptz;
  v_count integer;
  v_retry integer;
begin
  if v_scope = '' then
    raise exception 'p_scope is required';
  end if;
  if v_identifier = '' then
    raise exception 'p_identifier is required';
  end if;
  if char_length(v_scope) > 80 then
    raise exception 'p_scope is too long';
  end if;
  if char_length(v_identifier) > 180 then
    raise exception 'p_identifier is too long';
  end if;

  v_identifier_hash := md5(v_identifier);
  v_window_started_at := to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  );

  insert into public.edge_rate_limit_counters (
    scope,
    identifier_hash,
    window_seconds,
    window_started_at,
    request_count,
    created_at,
    updated_at
  )
  values (
    v_scope,
    v_identifier_hash,
    v_window_seconds,
    v_window_started_at,
    1,
    v_now,
    v_now
  )
  on conflict (scope, identifier_hash, window_seconds, window_started_at)
  do update set
    request_count = public.edge_rate_limit_counters.request_count + 1,
    updated_at = v_now
  returning public.edge_rate_limit_counters.request_count
  into v_count;

  if random() < 0.01 then
    delete from public.edge_rate_limit_counters
    where updated_at < (v_now - interval '7 days');
  end if;

  v_reset_at := v_window_started_at + make_interval(secs => v_window_seconds);

  if v_count > v_max_requests then
    v_retry := greatest(1, ceil(extract(epoch from (v_reset_at - v_now)))::integer);
    return query
      select false, 0, v_retry, v_reset_at, v_count;
  else
    return query
      select true, greatest(v_max_requests - v_count, 0), 0, v_reset_at, v_count;
  end if;
end;
$$;

revoke all on function public.consume_edge_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, text, integer, integer)
  to service_role, postgres;
