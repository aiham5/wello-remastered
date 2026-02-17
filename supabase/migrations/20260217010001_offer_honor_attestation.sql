-- Require explicit business/offer honor attestations to be stored with each
-- business onboarding and offer submission/edit.

alter table public.businesses
  add column if not exists offer_honor_policy_accepted boolean not null default false,
  add column if not exists offer_honor_policy_version text,
  add column if not exists offer_honor_policy_accepted_at timestamptz,
  add column if not exists offer_honor_policy_accepted_by uuid references auth.users on delete set null;

alter table public.offers
  add column if not exists offer_honor_commitment_accepted boolean not null default false,
  add column if not exists offer_honor_commitment_version text,
  add column if not exists offer_honor_commitment_accepted_at timestamptz,
  add column if not exists offer_honor_commitment_accepted_by uuid references auth.users on delete set null;

create or replace function public.require_business_offer_honor_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.offer_honor_policy_accepted is distinct from true then
    raise exception 'business_offer_honor_policy_required';
  end if;
  if coalesce(trim(new.offer_honor_policy_version), '') = '' then
    raise exception 'business_offer_honor_policy_version_required';
  end if;
  if new.offer_honor_policy_accepted_at is null then
    new.offer_honor_policy_accepted_at := now();
  end if;
  if new.offer_honor_policy_accepted_by is null then
    new.offer_honor_policy_accepted_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.require_offer_honor_commitment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  needs_enforcement boolean := false;
begin
  if tg_op = 'INSERT' then
    needs_enforcement := true;
  elsif new.approval_status = 'pending'
        and coalesce(old.approval_status, '') <> 'pending' then
    needs_enforcement := true;
  end if;

  if needs_enforcement then
    if new.offer_honor_commitment_accepted is distinct from true then
      raise exception 'offer_honor_commitment_required';
    end if;
    if coalesce(trim(new.offer_honor_commitment_version), '') = '' then
      raise exception 'offer_honor_commitment_version_required';
    end if;
    if new.offer_honor_commitment_accepted_at is null then
      new.offer_honor_commitment_accepted_at := now();
    end if;
    if new.offer_honor_commitment_accepted_by is null then
      new.offer_honor_commitment_accepted_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists require_business_offer_honor_policy on public.businesses;
create trigger require_business_offer_honor_policy
before insert on public.businesses
for each row execute function public.require_business_offer_honor_policy();

drop trigger if exists require_offer_honor_commitment on public.offers;
create trigger require_offer_honor_commitment
before insert or update on public.offers
for each row execute function public.require_offer_honor_commitment();
