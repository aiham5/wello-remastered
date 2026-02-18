-- Support business-specific merchant descriptor aliases for Plaid transaction matching.
-- Example aliases: "SQ * CAFE NAME", "CAFE NAME LLC", "DBA CAFE NAME".

alter table public.businesses
  add column if not exists merchant_descriptor_aliases text[] not null default '{}'::text[];

create or replace function public.normalize_merchant_descriptor_aliases(p_aliases text[])
returns text[]
language plpgsql
immutable
as $$
declare
  raw text;
  cleaned text;
  normalized text[] := '{}'::text[];
  lowered text[] := '{}'::text[];
begin
  if p_aliases is null then
    return '{}'::text[];
  end if;

  foreach raw in array p_aliases loop
    cleaned := regexp_replace(coalesce(raw, ''), '\s+', ' ', 'g');
    cleaned := btrim(cleaned);

    if cleaned = '' then
      continue;
    end if;

    if char_length(cleaned) > 120 then
      cleaned := left(cleaned, 120);
    end if;

    if lower(cleaned) = any(lowered) then
      continue;
    end if;

    normalized := array_append(normalized, cleaned);
    lowered := array_append(lowered, lower(cleaned));

    if coalesce(array_length(normalized, 1), 0) >= 25 then
      exit;
    end if;
  end loop;

  return normalized;
end;
$$;

create or replace function public.businesses_normalize_descriptor_aliases()
returns trigger
language plpgsql
as $$
begin
  new.merchant_descriptor_aliases :=
    public.normalize_merchant_descriptor_aliases(new.merchant_descriptor_aliases);
  return new;
end;
$$;

drop trigger if exists set_businesses_descriptor_aliases on public.businesses;
create trigger set_businesses_descriptor_aliases
before insert or update of merchant_descriptor_aliases
on public.businesses
for each row
execute function public.businesses_normalize_descriptor_aliases();

update public.businesses
set merchant_descriptor_aliases =
  public.normalize_merchant_descriptor_aliases(merchant_descriptor_aliases);
