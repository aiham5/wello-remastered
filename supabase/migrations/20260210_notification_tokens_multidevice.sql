-- Support multiple devices per user for push notifications.
-- This migration is written to be safe to run even if some changes were applied manually.

do $$
declare
  pk_name text;
begin
  -- Add an ID primary key if missing (lets us store multiple rows per user).
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_tokens'
      and column_name = 'id'
  ) then
    alter table public.notification_tokens
      add column id uuid default gen_random_uuid();
  end if;

  -- Ensure NOT NULL for id so it can become the primary key.
  begin
    alter table public.notification_tokens
      alter column id set not null;
  exception when others then
    -- Ignore if column doesn't exist yet (or already not null).
    null;
  end;

  -- Drop old PK if it is on user_id (or any non-id PK), then add PK on id.
  select c.conname into pk_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'notification_tokens'
    and c.contype = 'p'
  limit 1;

  if pk_name is not null then
    -- If the primary key is not already on id, replace it.
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any (c.conkey)
      where n.nspname = 'public'
        and t.relname = 'notification_tokens'
        and c.contype = 'p'
        and a.attname = 'id'
    ) then
      execute format('alter table public.notification_tokens drop constraint %I', pk_name);
    end if;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'notification_tokens'
      and c.contype = 'p'
  ) then
    alter table public.notification_tokens
      add constraint notification_tokens_pkey primary key (id);
  end if;
end $$;

-- De-dupe existing tokens before adding uniqueness.
with ranked as (
  select
    ctid,
    expo_push_token,
    row_number() over (
      partition by expo_push_token
      order by last_seen_at desc nulls last, created_at desc nulls last
    ) as rn
  from public.notification_tokens
  where expo_push_token is not null
)
delete from public.notification_tokens nt
using ranked r
where nt.ctid = r.ctid
  and r.rn > 1;

-- Unique token across all devices/users. (Allows reassign in server code.)
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'notification_tokens'
      and c.conname = 'notification_tokens_expo_push_token_uniq'
  ) then
    alter table public.notification_tokens
      add constraint notification_tokens_expo_push_token_uniq unique (expo_push_token);
  end if;
end $$;

create index if not exists notification_tokens_user_id_idx
  on public.notification_tokens(user_id);

