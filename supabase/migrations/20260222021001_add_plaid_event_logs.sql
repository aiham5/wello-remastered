-- Server-side Plaid event audit log for troubleshooting.
-- Stores non-sensitive metadata only (no access/public tokens).

create table if not exists public.plaid_event_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_function text not null,
  event_name text not null,
  severity text not null default 'info'
    check (severity in ('info', 'warn', 'error')),
  user_id uuid,
  plaid_item_id text,
  plaid_account_id text,
  request_id text,
  webhook_type text,
  webhook_code text,
  reason_code text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists plaid_event_logs_created_at_idx
  on public.plaid_event_logs (created_at desc);

create index if not exists plaid_event_logs_source_created_idx
  on public.plaid_event_logs (source_function, created_at desc);

create index if not exists plaid_event_logs_user_created_idx
  on public.plaid_event_logs (user_id, created_at desc);

create index if not exists plaid_event_logs_item_created_idx
  on public.plaid_event_logs (plaid_item_id, created_at desc);

alter table public.plaid_event_logs enable row level security;

-- Keep this table backend-only; service_role bypasses RLS.
revoke all on table public.plaid_event_logs from anon, authenticated;
