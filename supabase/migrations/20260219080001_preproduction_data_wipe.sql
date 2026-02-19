-- Pre-production data wipe.
-- Clears user/business/app runtime data so the project is clean for launch.
-- Keeps schema, policies, functions, and storage bucket definitions.

begin;

-- 1) Clear all public schema tables (runtime app data).
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

-- 2) Clear all auth users (consumer/staff/business accounts).
do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'delete from auth.users';
  end if;
end $$;

commit;
