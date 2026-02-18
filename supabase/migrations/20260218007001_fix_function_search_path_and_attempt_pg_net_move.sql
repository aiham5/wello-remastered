-- Resolve remaining security advisor warnings where safely possible:
-- 1) Set explicit search_path on descriptor helper functions.
-- 2) Attempt to move pg_net extension out of public if supported.
--    (No-op with notice if not supported in current extension/version.)
-- Safe to run multiple times.

create or replace function public.normalize_merchant_descriptor_aliases(p_aliases text[])
returns text[]
language plpgsql
immutable
set search_path = public
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
set search_path = public
as $$
begin
  new.merchant_descriptor_aliases :=
    public.normalize_merchant_descriptor_aliases(new.merchant_descriptor_aliases);
  return new;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    create schema if not exists extensions;
    begin
      execute 'alter extension pg_net set schema extensions';
      raise notice 'Moved pg_net extension to extensions schema.';
    exception
      when others then
        raise notice 'Unable to move pg_net with ALTER EXTENSION: %', sqlerrm;
        raise notice 'Leaving pg_net in current schema to avoid operational breakage.';
    end;
  end if;
end
$$;
