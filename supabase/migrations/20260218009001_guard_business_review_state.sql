-- Prevent non-staff callers from changing business approval state.
-- This blocks accidental or malicious auto-approval from client updates.
create or replace function public.guard_business_review_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_privileged boolean :=
    current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
    or coalesce(auth.role(), '') = 'service_role';
  caller_is_staff boolean := (select public.is_staff());
begin
  if caller_is_privileged or caller_is_staff then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Owner-created businesses must enter admin review first.
    new.approval_status := 'pending';
    if new.status is null then
      new.status := 'active';
    end if;
    return new;
  end if;

  -- Non-staff updates cannot alter approval lifecycle columns.
  new.approval_status := old.approval_status;
  new.status := old.status;
  return new;
end;
$$;

drop trigger if exists trg_guard_business_review_state on public.businesses;
create trigger trg_guard_business_review_state
before insert or update on public.businesses
for each row
execute function public.guard_business_review_state();
