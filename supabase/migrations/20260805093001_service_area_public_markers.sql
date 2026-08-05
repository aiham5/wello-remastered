alter table public.businesses
  add column if not exists private_address text,
  add column if not exists private_latitude double precision,
  add column if not exists private_longitude double precision,
  add column if not exists public_marker_latitude double precision,
  add column if not exists public_marker_longitude double precision,
  add column if not exists public_marker_source text,
  add column if not exists public_marker_offset_miles numeric(4, 2);

comment on column public.businesses.private_address is
  'Private real address for service-area businesses. Do not select in public client reads.';
comment on column public.businesses.public_marker_latitude is
  'Public map marker latitude for service-area businesses, offset from private address.';
comment on column public.businesses.public_marker_longitude is
  'Public map marker longitude for service-area businesses, offset from private address.';

revoke select (private_address, private_latitude, private_longitude)
  on public.businesses
  from anon, authenticated;
