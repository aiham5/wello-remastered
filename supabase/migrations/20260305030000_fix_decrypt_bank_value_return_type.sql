-- Fix decrypt helper return type handling for pgcrypto.
-- pgp_sym_decrypt(bytea, text) returns text, so convert_from() is invalid here.
-- Safe to run multiple times.

create or replace function public.decrypt_bank_value(
  p_cipher text,
  p_key text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cipher text := trim(coalesce(p_cipher, ''));
  v_key text := trim(coalesce(p_key, ''));
begin
  if v_cipher = '' then
    return null;
  end if;
  if length(v_key) < 16 then
    raise exception 'invalid encryption key';
  end if;
  if v_cipher not like 'enc::%' then
    raise exception 'invalid encrypted payload';
  end if;

  return pgp_sym_decrypt(
    dearmor(substring(v_cipher from 6)),
    v_key
  );
end;
$$;

