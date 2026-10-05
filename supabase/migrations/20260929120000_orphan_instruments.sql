-- An instrument goes with its last line (the owner's request, 2026-09-29).
--
-- Deleting an entry, an advanced transaction or an account used to leave its
-- instruments behind on the Instruments page, to be deleted by hand. Now an
-- instrument whose last line goes is deleted too, with its prices and values,
-- as delete_instrument does; its ÁKK rows (terms, observations, proposals)
-- cascade. The check runs at the end of the transaction, so an edit
-- (replace_entry deletes the old version, then writes the new one) keeps an
-- instrument the new version still uses. An instrument that never had a line
-- (added on the Instruments page) is not touched.

create function private.trg_drop_orphan_instrument() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.lines where instrument_id = old.instrument_id) then
    return null;
  end if;
  delete from public.price_quotes where instrument_id = old.instrument_id and owner_id = old.owner_id;
  delete from public.manual_valuations where instrument_id = old.instrument_id and owner_id = old.owner_id;
  delete from public.instruments where id = old.instrument_id and owner_id = old.owner_id;
  return null;
end $$;
revoke all on function private.trg_drop_orphan_instrument() from public, anon, authenticated, service_role;

create constraint trigger drop_orphan_instrument after delete on public.lines
  deferrable initially deferred for each row when (old.instrument_id is not null)
  execute function private.trg_drop_orphan_instrument();
