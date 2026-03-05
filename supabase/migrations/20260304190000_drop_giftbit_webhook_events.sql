-- Remove legacy giftbit webhook table artifacts.

drop table if exists public.giftbit_webhook_events;
