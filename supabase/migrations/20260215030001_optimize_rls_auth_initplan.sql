-- RLS performance cleanup:
-- Replace direct auth helpers in policy predicates with scalar subselects
-- so Postgres can initplan/cache them instead of re-evaluating per row.
--
-- Targets lints like:
-- - auth_rls_initplan
--
-- Safe to run multiple times.

do $$
declare
  rec record;
  original_qual text;
  original_check text;
  updated_qual text;
  updated_check text;
begin
  for rec in
    select
      schemaname,
      tablename,
      policyname,
      qual,
      with_check
    from pg_policies
    where schemaname in ('public', 'storage')
  loop
    original_qual := rec.qual;
    original_check := rec.with_check;
    updated_qual := rec.qual;
    updated_check := rec.with_check;

    if updated_qual is not null then
      -- Keep already-optimized expressions untouched.
      updated_qual := replace(updated_qual, '(select auth.uid())', '__AUTH_UID__');
      updated_qual := replace(updated_qual, '(select auth.role())', '__AUTH_ROLE__');

      updated_qual := regexp_replace(
        updated_qual,
        '\bauth\.uid\(\)',
        '(select auth.uid())',
        'gi'
      );
      updated_qual := regexp_replace(
        updated_qual,
        '\bauth\.role\(\)',
        '(select auth.role())',
        'gi'
      );

      updated_qual := replace(updated_qual, '__AUTH_UID__', '(select auth.uid())');
      updated_qual := replace(updated_qual, '__AUTH_ROLE__', '(select auth.role())');
    end if;

    if updated_check is not null then
      updated_check := replace(updated_check, '(select auth.uid())', '__AUTH_UID__');
      updated_check := replace(updated_check, '(select auth.role())', '__AUTH_ROLE__');

      updated_check := regexp_replace(
        updated_check,
        '\bauth\.uid\(\)',
        '(select auth.uid())',
        'gi'
      );
      updated_check := regexp_replace(
        updated_check,
        '\bauth\.role\(\)',
        '(select auth.role())',
        'gi'
      );

      updated_check := replace(updated_check, '__AUTH_UID__', '(select auth.uid())');
      updated_check := replace(updated_check, '__AUTH_ROLE__', '(select auth.role())');
    end if;

    if updated_qual is distinct from original_qual then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        rec.policyname,
        rec.schemaname,
        rec.tablename,
        updated_qual
      );
    end if;

    if updated_check is distinct from original_check then
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        rec.policyname,
        rec.schemaname,
        rec.tablename,
        updated_check
      );
    end if;
  end loop;
end
$$;

