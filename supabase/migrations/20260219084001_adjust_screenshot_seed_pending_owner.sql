-- Keep business-owner screenshot account in a clean approved/stripe-ready state.
-- Move pending queue seed records away from the seeded business owner account.

do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id
  from auth.users
  where lower(email) = 'screenshots.admin@wellopartners.com'
  order by created_at desc
  limit 1;

  if v_admin_id is null then
    return;
  end if;

  update public.businesses
  set owner_id = v_admin_id,
      updated_at = now()
  where id = '71000000-0000-4000-8000-000000000009'::uuid;
end $$;
