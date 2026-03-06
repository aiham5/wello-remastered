-- Allow dispute approvals to land in a distinct receipt report status.
-- Safe to run multiple times.

alter table public.receipt_reports
  drop constraint if exists receipt_reports_status_check;

alter table public.receipt_reports
  add constraint receipt_reports_status_check
  check (status in ('open', 'reviewing', 'resolved', 'dismissed', 'disputed'));
