-- pg_net cannot be moved in-place with ALTER EXTENSION ... SET SCHEMA.
-- Keep this migration as a safe no-op + diagnostic so deploys don't fail.
--
-- If you must clear the Advisor warning, pg_net must be reinstalled
-- (drop/create), which is operationally risky because dependent routines
-- and jobs using net.http_post may need to be recreated.

do $$
declare
  current_schema text;
begin
  select n.nspname
    into current_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net'
  limit 1;

  if current_schema is null then
    raise notice 'pg_net extension is not installed; skipping.';
  elsif current_schema <> 'public' then
    raise notice 'pg_net extension is already outside public (schema=%).', current_schema;
  else
    raise notice
      'pg_net is in public and cannot be moved with ALTER EXTENSION. Leave as-is, or plan a controlled drop/recreate.';
  end if;
end
$$;
