-- Admin panel action audit and guarded moderation RPC helpers.

create table if not exists public.admin_action_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  actor_role text,
  action text not null,
  entity text not null,
  entity_id text,
  status text not null default 'success' check (status in ('success', 'failed')),
  before_state jsonb,
  after_state jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_action_logs_created_idx
  on public.admin_action_logs(created_at desc);

create index if not exists admin_action_logs_entity_idx
  on public.admin_action_logs(entity, created_at desc);

alter table public.admin_action_logs enable row level security;

revoke all on public.admin_action_logs from anon;
revoke all on public.admin_action_logs from authenticated;
grant select on public.admin_action_logs to authenticated;
grant all on public.admin_action_logs to service_role;

drop policy if exists "Staff can read admin action logs" on public.admin_action_logs;
create policy "Staff can read admin action logs"
on public.admin_action_logs
for select
to authenticated
using ((select public.is_staff()));

create or replace function public.admin_write_action_log(
  p_action text,
  p_entity text,
  p_entity_id text default null,
  p_status text default 'success',
  p_before_state jsonb default null,
  p_after_state jsonb default null,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_role text;
  v_id uuid;
begin
  if v_actor_id is null then
    raise exception 'not_authenticated';
  end if;

  if not (select public.is_staff()) then
    raise exception 'forbidden';
  end if;

  select role into v_actor_role
  from public.profiles
  where id = v_actor_id;

  insert into public.admin_action_logs (
    actor_id,
    actor_role,
    action,
    entity,
    entity_id,
    status,
    before_state,
    after_state,
    meta
  )
  values (
    v_actor_id,
    v_actor_role,
    coalesce(p_action, 'unknown'),
    coalesce(p_entity, 'unknown'),
    p_entity_id,
    case when p_status in ('success', 'failed') then p_status else 'success' end,
    p_before_state,
    p_after_state,
    coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.admin_write_action_log(text, text, text, text, jsonb, jsonb, jsonb)
to authenticated;

create or replace function public.admin_review_receipt(
  p_receipt_id uuid,
  p_receipt_total_cents integer,
  p_review_status text,
  p_review_notes text default null,
  p_reviewed_by uuid default null
)
returns public.receipt_uploads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.receipt_uploads;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  if not (select public.is_staff()) then
    raise exception 'forbidden';
  end if;

  if p_review_status not in ('verified', 'rejected') then
    raise exception 'invalid_review_status';
  end if;

  if p_review_status = 'verified' and coalesce(p_receipt_total_cents, 0) <= 0 then
    raise exception 'invalid_receipt_total';
  end if;

  update public.receipt_uploads
  set
    receipt_total_cents = coalesce(p_receipt_total_cents, receipt_total_cents),
    review_status = p_review_status,
    review_notes = p_review_notes,
    reviewed_by = coalesce(p_reviewed_by, v_actor),
    reviewed_at = now()
  where id = p_receipt_id
    and review_status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  perform public.admin_write_action_log(
    case when p_review_status = 'verified' then 'receipt_verified' else 'receipt_rejected' end,
    'receipt_uploads',
    v_row.id::text,
    'success',
    jsonb_build_object('previous_status', 'pending'),
    jsonb_build_object('next_status', p_review_status, 'receipt_total_cents', v_row.receipt_total_cents),
    '{}'::jsonb
  );

  return v_row;
end;
$$;

grant execute on function public.admin_review_receipt(uuid, integer, text, text, uuid)
to authenticated;

create or replace function public.admin_update_receipt_report(
  p_report_id uuid,
  p_status text,
  p_resolution_notes text default null,
  p_resolved_by uuid default null
)
returns public.receipt_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.receipt_reports;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  if not (select public.is_staff()) then
    raise exception 'forbidden';
  end if;

  if p_status not in ('reviewing', 'resolved', 'dismissed') then
    raise exception 'invalid_report_status';
  end if;

  update public.receipt_reports
  set
    status = p_status,
    resolution_notes = p_resolution_notes,
    resolved_by = case when p_status in ('resolved', 'dismissed') then coalesce(p_resolved_by, v_actor) else null end,
    resolved_at = case when p_status in ('resolved', 'dismissed') then now() else null end,
    updated_at = now()
  where id = p_report_id
    and status in ('open', 'reviewing')
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  perform public.admin_write_action_log(
    'receipt_report_updated',
    'receipt_reports',
    v_row.id::text,
    'success',
    null,
    jsonb_build_object('status', p_status),
    '{}'::jsonb
  );

  return v_row;
end;
$$;

grant execute on function public.admin_update_receipt_report(uuid, text, text, uuid)
to authenticated;

create or replace function public.admin_review_business(
  p_business_id uuid,
  p_next_approval_status text
)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.businesses;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if not (select public.is_staff()) then
    raise exception 'forbidden';
  end if;

  if p_next_approval_status not in ('approved', 'rejected') then
    raise exception 'invalid_business_status';
  end if;

  update public.businesses
  set
    approval_status = p_next_approval_status,
    status = case when p_next_approval_status = 'approved' then 'active' else 'inactive' end,
    updated_at = now()
  where id = p_business_id
    and approval_status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  perform public.admin_write_action_log(
    case when p_next_approval_status = 'approved' then 'business_approved' else 'business_rejected' end,
    'businesses',
    v_row.id::text,
    'success',
    jsonb_build_object('previous_status', 'pending'),
    jsonb_build_object('next_status', p_next_approval_status),
    '{}'::jsonb
  );

  return v_row;
end;
$$;

grant execute on function public.admin_review_business(uuid, text)
to authenticated;

create or replace function public.admin_review_offer(
  p_offer_id uuid,
  p_next_approval_status text
)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.offers;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if not (select public.is_staff()) then
    raise exception 'forbidden';
  end if;

  if p_next_approval_status not in ('approved', 'rejected') then
    raise exception 'invalid_offer_status';
  end if;

  update public.offers
  set
    approval_status = p_next_approval_status,
    active = (p_next_approval_status = 'approved'),
    updated_at = now()
  where id = p_offer_id
    and approval_status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  perform public.admin_write_action_log(
    case when p_next_approval_status = 'approved' then 'offer_approved' else 'offer_rejected' end,
    'offers',
    v_row.id::text,
    'success',
    jsonb_build_object('previous_status', 'pending'),
    jsonb_build_object('next_status', p_next_approval_status),
    '{}'::jsonb
  );

  return v_row;
end;
$$;

grant execute on function public.admin_review_offer(uuid, text)
to authenticated;

create or replace function public.admin_update_user_role(
  p_profile_id uuid,
  p_expected_role text,
  p_next_role text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  if not (select public.is_staff()) then
    raise exception 'forbidden';
  end if;

  if p_next_role not in ('consumer', 'business_owner', 'supervisor', 'admin') then
    raise exception 'invalid_role';
  end if;

  if p_profile_id = v_actor then
    raise exception 'self_role_change_blocked';
  end if;

  update public.profiles
  set
    role = p_next_role,
    updated_at = now()
  where id = p_profile_id
    and role = coalesce(p_expected_role, role)
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  perform public.admin_write_action_log(
    'profile_role_updated',
    'profiles',
    v_row.id::text,
    'success',
    jsonb_build_object('expected_role', p_expected_role),
    jsonb_build_object('next_role', p_next_role),
    '{}'::jsonb
  );

  return v_row;
end;
$$;

grant execute on function public.admin_update_user_role(uuid, text, text)
to authenticated;

