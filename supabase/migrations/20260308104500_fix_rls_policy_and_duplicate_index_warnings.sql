drop policy if exists "account deletion requests owner select"
  on public.account_deletion_requests;

drop policy if exists "account deletion requests staff select"
  on public.account_deletion_requests;

create policy "account deletion requests authenticated select"
on public.account_deletion_requests
for select
to authenticated
using (
  ((select auth.uid()) = user_id)
  or public.is_staff()
);

drop index if exists public.cashout_payouts_user_provider_idempotency_uq;
