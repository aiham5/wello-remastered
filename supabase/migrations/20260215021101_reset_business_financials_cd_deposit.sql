-- One-off reset for business financial metrics.
-- Target business:
-- 9eeb3b0e-5068-417d-97cf-b19a028a9daa (CD DEPOSIT .INITIAL.)
--
-- Effect:
-- - receipt_uploads totals/commission/review reset to pending + zero
-- - commission_events marked failed + zero amount
-- - open/draft commission_invoices set failed + zero amount

do $$
declare
  v_business_id uuid := '9eeb3b0e-5068-417d-97cf-b19a028a9daa'::uuid;
begin
  update public.receipt_uploads
  set
    receipt_total_cents = 0,
    commission_due_cents = 0,
    review_status = 'pending',
    review_notes = 'Financial reset applied by admin migration.',
    reviewed_by = null,
    reviewed_at = null
  where business_id = v_business_id;

  update public.commission_events
  set
    amount_cents = 0,
    status = 'failed'
  where business_id = v_business_id;

  update public.commission_invoices
  set
    amount_cents = 0,
    status = 'failed'
  where business_id = v_business_id
    and status in ('draft', 'open');
end;
$$;

