-- Audit trail for business approval/rejection lifecycle changes.

create table if not exists public.business_review_audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  previous_approval_status text,
  next_approval_status text,
  previous_status text,
  next_status text,
  changed_by uuid,
  changed_role text,
  changed_via text not null default 'unknown',
  changed_at timestamptz not null default now()
);

create index if not exists business_review_audit_log_business_changed_at_idx
  on public.business_review_audit_log (business_id, changed_at desc);

create index if not exists business_review_audit_log_changed_at_idx
  on public.business_review_audit_log (changed_at desc);

alter table public.business_review_audit_log enable row level security;

drop policy if exists "Staff can read business review audit log" on public.business_review_audit_log;
create policy "Staff can read business review audit log"
on public.business_review_audit_log
for select
to public
using ((select public.is_staff()));

create or replace function public.log_business_review_state_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text := null;
  actor_via text := 'unknown';
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.approval_status is not distinct from old.approval_status
     and new.status is not distinct from old.status then
    return new;
  end if;

  if actor_id is not null then
    select p.role
      into actor_role
    from public.profiles p
    where p.id = actor_id;
  end if;

  actor_via := case
    when coalesce(auth.role(), '') = 'service_role' then 'service_role'
    when current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin') then current_user
    when actor_id is not null then 'authenticated'
    else 'unknown'
  end;

  insert into public.business_review_audit_log (
    business_id,
    previous_approval_status,
    next_approval_status,
    previous_status,
    next_status,
    changed_by,
    changed_role,
    changed_via
  ) values (
    new.id,
    old.approval_status,
    new.approval_status,
    old.status,
    new.status,
    actor_id,
    actor_role,
    actor_via
  );

  return new;
end;
$$;

drop trigger if exists trg_log_business_review_state_change on public.businesses;
create trigger trg_log_business_review_state_change
after update on public.businesses
for each row
execute function public.log_business_review_state_change();
