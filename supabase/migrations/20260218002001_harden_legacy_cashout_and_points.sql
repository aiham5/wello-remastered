-- Harden legacy/unused feature surfaces:
-- 1) Cashout switch RPCs (legacy): service-role only.
-- 2) Points system (legacy): disable triggers + block direct client execution.
-- Safe to run multiple times.

-- 1) Cashout switch RPCs: restrict to service_role only.
revoke execute on function public.get_cashout_bank_switch_policy(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.consume_cashout_bank_switch(uuid, text, text, integer)
  from public, anon, authenticated;

grant execute on function public.get_cashout_bank_switch_policy(uuid, integer)
  to service_role;
grant execute on function public.consume_cashout_bank_switch(uuid, text, text, integer)
  to service_role;

-- 2) Points system: disable trigger side-effects.
drop trigger if exists award_points_on_redemption on public.redemptions;
drop trigger if exists award_points_on_review on public.reviews;

-- Block direct client execution of legacy points helpers.
revoke execute on function public.increment_points(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.award_points_on_redemption()
  from public, anon, authenticated;
revoke execute on function public.award_points_on_review()
  from public, anon, authenticated;
