-- Fix ON CONFLICT target for commission_events by ensuring redemption_id is unique.
-- This prevents receipt review saves from failing inside sync_commission_event().
-- Safe to run multiple times.

-- If duplicates exist (possible if the unique index was missing), keep the "best" row per redemption:
-- paid > invoiced > pending > failed, then newest created_at.
with ranked as (
  select
    id,
    redemption_id,
    row_number() over (
      partition by redemption_id
      order by
        case status
          when 'paid' then 4
          when 'invoiced' then 3
          when 'pending' then 2
          else 1
        end desc,
        created_at desc,
        id desc
    ) as rn
  from public.commission_events
)
delete from public.commission_events ce
using ranked r
where ce.id = r.id
  and r.rn > 1;

create unique index if not exists commission_events_redemption_id_idx
  on public.commission_events(redemption_id);

