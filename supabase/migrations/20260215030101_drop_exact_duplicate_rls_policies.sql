-- RLS cleanup:
-- Drop exact duplicate permissive policies (same table/action/roles/qual/check).
--
-- This is semantics-preserving because duplicates are byte-for-byte equivalent.
-- Safe to run multiple times.

do $$
declare
  grp record;
  keep_policy text;
  drop_policy text;
begin
  for grp in
    select
      schemaname,
      tablename,
      cmd,
      permissive,
      roles,
      coalesce(qual, '') as qual_norm,
      coalesce(with_check, '') as check_norm,
      array_agg(policyname order by policyname) as policy_names
    from pg_policies
    where schemaname in ('public', 'storage')
      and permissive = 'PERMISSIVE'
    group by
      schemaname,
      tablename,
      cmd,
      permissive,
      roles,
      coalesce(qual, ''),
      coalesce(with_check, '')
    having count(*) > 1
  loop
    keep_policy := grp.policy_names[1];

    foreach drop_policy in array grp.policy_names loop
      if drop_policy is distinct from keep_policy then
        execute format(
          'drop policy if exists %I on %I.%I',
          drop_policy,
          grp.schemaname,
          grp.tablename
        );
      end if;
    end loop;
  end loop;
end
$$;

