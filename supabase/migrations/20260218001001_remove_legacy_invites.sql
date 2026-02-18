-- Remove legacy invites system that is no longer used.
-- Safe to run multiple times.

drop policy if exists "Invites are readable" on public.invites;
drop policy if exists "Invites are insertable" on public.invites;
drop policy if exists "Invites can be claimed once" on public.invites;

drop table if exists public.invites;
