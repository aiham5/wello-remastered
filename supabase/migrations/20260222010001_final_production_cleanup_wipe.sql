-- Final production cleanup wipe.
-- Removes seeded/demo/runtime data so launch starts from an empty state.
-- Keeps schema, RLS, functions, and required storage bucket definitions.

begin;

-- 1) Clear all runtime app rows in public schema.
do $$
declare
  public_tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ' order by tablename)
    into public_tables
  from pg_tables
  where schemaname = 'public'
    and tablename <> 'spatial_ref_sys';

  if public_tables is not null then
    execute 'truncate table ' || public_tables || ' restart identity cascade';
  end if;
end $$;

-- 2) Clear auth-side account/session state.
-- Deleting users removes consumer/business/admin accounts.
delete from auth.users;
delete from auth.flow_state;

do $$
begin
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions';
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens';
  end if;
  if to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens';
  end if;
end $$;

-- 3) Ensure required storage buckets exist after wipe.
insert into storage.buckets (id, name, public)
values
  ('offer-images', 'offer-images', true),
  ('receipt-images', 'receipt-images', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;

commit;
