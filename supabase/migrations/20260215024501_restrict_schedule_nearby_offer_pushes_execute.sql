-- Restrict execution of nearby digest scheduler helper to privileged roles.
-- This prevents non-admin callers from rescheduling cron jobs.

revoke execute on function public.schedule_nearby_offer_pushes()
  from public, anon, authenticated;

grant execute on function public.schedule_nearby_offer_pushes()
  to service_role, postgres;
