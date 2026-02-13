-- Ensure FK constraints exist for promo_code_id columns so PostgREST can resolve relationships.
-- This is needed because `add column if not exists ... references ...` does NOT add the FK
-- if the column already existed.
--
-- Safe to run multiple times.

do $$
begin
  -- receipt_uploads.promo_code_id -> promo_codes.id
  if exists (
    select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'receipt_uploads'
        and column_name = 'promo_code_id'
  ) then
    -- Null out invalid values (prevents FK creation failure).
    update public.receipt_uploads ru
      set promo_code_id = null
      where promo_code_id is not null
        and not exists (
          select 1 from public.promo_codes pc where pc.id = ru.promo_code_id
        );

    -- Only create the FK if there's no existing FK from receipt_uploads(promo_code_id)
    -- to promo_codes(id). PostgREST uses this to infer relationships for nested selects.
    if not exists (
      select 1
        from pg_constraint c
        where c.contype = 'f'
          and c.conrelid = 'public.receipt_uploads'::regclass
          and c.confrelid = 'public.promo_codes'::regclass
          and array_length(c.conkey, 1) = 1
          and c.conkey[1] = (
            select a.attnum
              from pg_attribute a
              where a.attrelid = 'public.receipt_uploads'::regclass
                and a.attname = 'promo_code_id'
                and a.attisdropped = false
          )
          and array_length(c.confkey, 1) = 1
          and c.confkey[1] = (
            select a.attnum
              from pg_attribute a
              where a.attrelid = 'public.promo_codes'::regclass
                and a.attname = 'id'
                and a.attisdropped = false
          )
    ) then
      alter table public.receipt_uploads
        add constraint receipt_uploads_promo_code_id_fkey
        foreign key (promo_code_id)
        references public.promo_codes(id)
        on delete set null;
    end if;
  end if;

  -- cashback_events.promo_code_id -> promo_codes.id
  if exists (
    select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'cashback_events'
        and column_name = 'promo_code_id'
  ) then
    update public.cashback_events ce
      set promo_code_id = null
      where promo_code_id is not null
        and not exists (
          select 1 from public.promo_codes pc where pc.id = ce.promo_code_id
        );

    if not exists (
      select 1
        from pg_constraint c
        where c.contype = 'f'
          and c.conrelid = 'public.cashback_events'::regclass
          and c.confrelid = 'public.promo_codes'::regclass
          and array_length(c.conkey, 1) = 1
          and c.conkey[1] = (
            select a.attnum
              from pg_attribute a
              where a.attrelid = 'public.cashback_events'::regclass
                and a.attname = 'promo_code_id'
                and a.attisdropped = false
          )
          and array_length(c.confkey, 1) = 1
          and c.confkey[1] = (
            select a.attnum
              from pg_attribute a
              where a.attrelid = 'public.promo_codes'::regclass
                and a.attname = 'id'
                and a.attisdropped = false
          )
    ) then
      alter table public.cashback_events
        add constraint cashback_events_promo_code_id_fkey
        foreign key (promo_code_id)
        references public.promo_codes(id)
        on delete set null;
    end if;
  end if;
end $$;
