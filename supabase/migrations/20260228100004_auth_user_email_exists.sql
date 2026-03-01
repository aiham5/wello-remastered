-- Fast auth email existence check for auth-email-availability edge function.
-- Safe to run multiple times.

create or replace function public.auth_user_email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    where lower(trim(u.email)) = lower(trim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.auth_user_email_exists(text)
  from public, anon, authenticated;
grant execute on function public.auth_user_email_exists(text)
  to service_role, postgres;
