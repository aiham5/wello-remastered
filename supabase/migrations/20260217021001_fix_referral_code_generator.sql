-- Fix referral code generation to avoid dependency on gen_random_bytes().
-- Safe to run multiple times.

create or replace function public.ensure_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_user_id is null then
    return null;
  end if;

  select rc.code
    into v_code
  from public.referral_codes rc
  where rc.user_id = p_user_id;

  if v_code is not null then
    return v_code;
  end if;

  loop
    v_code := upper(
      substr(
        md5(
          coalesce(p_user_id::text, '') ||
          ':' ||
          clock_timestamp()::text ||
          ':' ||
          random()::text
        ),
        1,
        10
      )
    );
    begin
      insert into public.referral_codes (user_id, code)
      values (p_user_id, v_code);
      return v_code;
    exception
      when unique_violation then
        select rc.code
          into v_code
        from public.referral_codes rc
        where rc.user_id = p_user_id;
        if v_code is not null then
          return v_code;
        end if;
    end;
  end loop;
end;
$$;

revoke all on function public.ensure_referral_code(uuid) from public;
grant execute on function public.ensure_referral_code(uuid) to authenticated, service_role;
