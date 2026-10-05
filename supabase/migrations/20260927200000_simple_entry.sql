-- Phase 4c: simple entries (4c plan §5).
--
--  * An entry is what the simple form records as one unit: an opening row, a
--    buy (deposit + buy) or a sale (sell + withdrawal). Its events share
--    events.entry_id. A manual price or value the entry brings (an opening
--    price typed in, a manual item's total) carries the same id: it lives and
--    dies with the entry. Independent observations (the refresh, "Érték
--    frissítése", Yahoo closes) keep entry_id null and stay append-only.
--  * record_entry: broker, account and instruments are created with the
--    entry's events in one transaction, under the caller's RLS. The deferred
--    checks run once, at its end.
--  * replace_entry: an edit keeps the entry id and its place in the day's
--    order (created_at); the history check sees the result as a whole.
--  * delete_entry / delete_account / delete_instrument: security definer,
--    because the price and value logs are closed to deletes for everyone else.
--    Each starts with the trusted-owner check and touches own rows only.

------------------------------------------------------------------------------
-- 1. Entry ids
------------------------------------------------------------------------------
alter table public.events add column entry_id uuid;
create index events_entry_idx on public.events (entry_id) where entry_id is not null;

alter table public.price_quotes add column entry_id uuid;
alter table public.price_quotes add constraint price_quotes_entry_manual check (entry_id is null or source = 'manual');
create index price_quotes_entry_idx on public.price_quotes (entry_id) where entry_id is not null;

alter table public.manual_valuations add column entry_id uuid;
create index manual_valuations_entry_idx on public.manual_valuations (entry_id) where entry_id is not null;

-- A correction of a removed row goes with it.
alter table public.price_quotes drop constraint price_quotes_supersedes_id_fkey,
  add constraint price_quotes_supersedes_id_fkey foreign key (supersedes_id) references public.price_quotes (id) on delete cascade;
alter table public.manual_valuations drop constraint manual_valuations_supersedes_id_fkey,
  add constraint manual_valuations_supersedes_id_fkey foreign key (supersedes_id) references public.manual_valuations (id) on delete cascade;

-- Only the functions below delete from the logs; the audit log keeps what went.
create trigger audit after delete on public.price_quotes for each row execute function private.audit_row();
create trigger audit after delete on public.manual_valuations for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- 2. One Yahoo instrument per symbol and owner
------------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.instruments
    where price_source = 'yahoo' and provider_symbol is not null
    group by owner_id, upper(provider_symbol) having count(*) > 1
  ) then
    raise exception 'Duplicate Yahoo symbols: merge or rename those instruments before this migration.';
  end if;
end $$;
create unique index instruments_one_per_yahoo_symbol on public.instruments (owner_id, upper(provider_symbol)) where price_source = 'yahoo';

------------------------------------------------------------------------------
-- 3. Guards on accounts and instruments
------------------------------------------------------------------------------
-- The tracking start only moves earlier, and never under an opening balance
-- (opening balances belong to that very day).
create function private.check_tracking_start() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.tracking_start_date is distinct from old.tracking_start_date then
    if new.tracking_start_date > old.tracking_start_date then
      raise exception 'tracking_start_later' using errcode = '23514';
    end if;
    if exists (select 1 from public.lines l join public.events e on e.id = l.event_id
               where l.account_id = new.id and e.event_type = 'opening_balance') then
      raise exception 'tracking_start_has_opening' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger check_tracking_start before update on public.accounts
  for each row execute function private.check_tracking_start();

-- Currency and valuation kind are fixed once anything refers to the instrument.
create function private.check_instrument_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.currency is distinct from old.currency and (
       exists (select 1 from public.lines where instrument_id = new.id)
       or exists (select 1 from public.price_quotes where instrument_id = new.id)
       or exists (select 1 from public.manual_valuations where instrument_id = new.id)) then
    raise exception 'instrument_currency_locked' using errcode = '23514';
  end if;
  if new.valuation is distinct from old.valuation and exists (select 1 from public.lines where instrument_id = new.id) then
    raise exception 'instrument_valuation_locked' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger check_instrument_update before update on public.instruments
  for each row execute function private.check_instrument_update();

revoke all on function private.check_tracking_start(), private.check_instrument_update() from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- 4. Writing entries (security invoker: RLS applies to every row)
--
-- Payload (camelCase, amounts as decimal strings):
--   institution?  {id, name}
--   account?      {id, institutionId, name, accountType, trackingStart}
--   instruments?  [{id, name, assetClass, currency, ticker, exchange, valuation, priceSource, providerSymbol}]
--   trackingStart? {accountId, day}             -- an existing account's start, moved earlier
--   yahooQuotes?  [{instrumentId, price, currency, asOf}]
--   entries       [{id, events: [{type, date, note, lines, quotes, valuations}]}]
------------------------------------------------------------------------------
create function public.write_entry(p jsonb, p_created_at timestamptz) returns uuid[]
language plpgsql security invoker set search_path = '' as $$
declare
  en jsonb;
  ev jsonb;
  v_entry uuid;
  v_event uuid;
  ids uuid[] := '{}';
begin
  if jsonb_typeof(p -> 'institution') = 'object' then
    insert into public.institutions (id, name) values ((p -> 'institution' ->> 'id')::uuid, p -> 'institution' ->> 'name');
  end if;
  if jsonb_typeof(p -> 'account') = 'object' then
    insert into public.accounts (id, institution_id, name, account_type, tracking_start_date)
    values ((p -> 'account' ->> 'id')::uuid, (p -> 'account' ->> 'institutionId')::uuid, p -> 'account' ->> 'name',
            p -> 'account' ->> 'accountType', (p -> 'account' ->> 'trackingStart')::date);
  end if;
  insert into public.instruments (id, name, asset_class, currency, ticker, exchange, valuation, price_source, provider_symbol)
  select (x ->> 'id')::uuid, x ->> 'name', x ->> 'assetClass', x ->> 'currency', x ->> 'ticker', x ->> 'exchange',
         x ->> 'valuation', x ->> 'priceSource', x ->> 'providerSymbol'
  from jsonb_array_elements(coalesce(p -> 'instruments', '[]'::jsonb)) x;

  if jsonb_typeof(p -> 'trackingStart') = 'object' then
    update public.accounts set tracking_start_date = (p -> 'trackingStart' ->> 'day')::date
    where id = (p -> 'trackingStart' ->> 'accountId')::uuid;
    if not found then
      raise exception 'unknown_account' using errcode = '42501';
    end if;
  end if;

  -- Market closes are observations of their own: a repeated one adds nothing.
  insert into public.price_quotes (instrument_id, price, currency, as_of, source, status)
  select (x ->> 'instrumentId')::uuid, (x ->> 'price')::numeric, x ->> 'currency', (x ->> 'asOf')::timestamptz, 'yahoo', 'ok'
  from jsonb_array_elements(coalesce(p -> 'yahooQuotes', '[]'::jsonb)) x
  on conflict (instrument_id, source, as_of) where source <> 'manual' do nothing;

  for en in select * from jsonb_array_elements(coalesce(p -> 'entries', '[]'::jsonb)) loop
    v_entry := (en ->> 'id')::uuid;
    if v_entry is null or jsonb_array_length(coalesce(en -> 'events', '[]'::jsonb)) = 0 then
      raise exception 'empty_entry' using errcode = '22023';
    end if;
    if exists (select 1 from public.events where entry_id = v_entry) then
      raise exception 'entry_exists' using errcode = '22023';
    end if;
    for ev in select * from jsonb_array_elements(en -> 'events') loop
      if coalesce(ev ->> 'type', '') not in ('opening_balance', 'deposit', 'buy', 'sell', 'withdrawal') then
        raise exception 'invalid_entry_type' using errcode = '22023';
      end if;
      insert into public.events (event_type, event_date, note, entry_id, created_at)
      values (ev ->> 'type', (ev ->> 'date')::date, ev ->> 'note', v_entry, p_created_at)
      returning id into v_event;

      insert into public.lines (event_id, account_id, instrument_id, kind, currency, amount, role,
                                cost_amount, cost_estimated, cost_fx_refs)
      select v_event, (l ->> 'accountId')::uuid, nullif(l ->> 'instrumentId', '')::uuid, l ->> 'kind', l ->> 'currency',
             (l ->> 'amount')::numeric, l ->> 'role', nullif(l ->> 'costAmount', '')::numeric,
             coalesce((l ->> 'costEstimated')::boolean, false), l -> 'costFxRefs'
      from jsonb_array_elements(coalesce(ev -> 'lines', '[]'::jsonb)) l;

      insert into public.price_quotes (instrument_id, price, currency, as_of, source, note, entry_id)
      select (q ->> 'instrumentId')::uuid, (q ->> 'price')::numeric, q ->> 'currency', (q ->> 'asOf')::timestamptz,
             'manual', q ->> 'note', v_entry
      from jsonb_array_elements(coalesce(ev -> 'quotes', '[]'::jsonb)) q;

      insert into public.manual_valuations (account_id, instrument_id, value, currency, as_of, note, entry_id)
      select (v ->> 'accountId')::uuid, (v ->> 'instrumentId')::uuid, (v ->> 'value')::numeric, v ->> 'currency',
             (v ->> 'asOf')::timestamptz, v ->> 'note', v_entry
      from jsonb_array_elements(coalesce(ev -> 'valuations', '[]'::jsonb)) v;
    end loop;
    ids := array_append(ids, v_entry);
  end loop;
  return ids;
end $$;

create function public.record_entry(p jsonb) returns uuid[]
language plpgsql security invoker set search_path = '' as $$
declare ids uuid[];
begin
  set constraints all deferred;
  ids := public.write_entry(p, now());
  -- Everything written above is checked here, once, for a clear error.
  set constraints all immediate;
  return ids;
end $$;

------------------------------------------------------------------------------
-- 5. Deleting (security definer: the price and value logs are append-only
--    for everyone else). Own rows only, trusted owner only.
------------------------------------------------------------------------------
create function public.delete_entry(p_entry uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not private.trusted_owner() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.events where entry_id = p_entry and owner_id = auth.uid();
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'unknown_entry' using errcode = 'P0002';
  end if;
  delete from public.price_quotes where entry_id = p_entry and owner_id = auth.uid();
  delete from public.manual_valuations where entry_id = p_entry and owner_id = auth.uid();
  return n;
end $$;

create function public.replace_entry(p_entry uuid, p jsonb) returns uuid[]
language plpgsql security invoker set search_path = '' as $$
declare
  v_created timestamptz;
  ids uuid[];
begin
  if jsonb_array_length(coalesce(p -> 'entries', '[]'::jsonb)) <> 1 or (p -> 'entries' -> 0 ->> 'id')::uuid is distinct from p_entry then
    raise exception 'entry_mismatch' using errcode = '22023';
  end if;
  select min(created_at) into v_created from public.events where entry_id = p_entry;
  if v_created is null then
    raise exception 'unknown_entry' using errcode = 'P0002';
  end if;
  set constraints all deferred;
  perform public.delete_entry(p_entry);
  ids := public.write_entry(p, v_created);
  set constraints all immediate;
  return ids;
end $$;

create function public.delete_account(p_account uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a record;
  v_events uuid[];
  v_entries uuid[];
  n_events integer;
  n_values integer;
begin
  if not private.trusted_owner() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select id, name, institution_id into a from public.accounts where id = p_account and owner_id = auth.uid();
  if not found then
    raise exception 'unknown_account' using errcode = 'P0002';
  end if;
  if btrim(a.name) <> btrim(coalesce(p_name, '')) then
    raise exception 'name_mismatch' using errcode = '22023';
  end if;

  -- Whole events: the other side of a transfer goes with it.
  select coalesce(array_agg(distinct l.event_id), '{}') into v_events
  from public.lines l where l.account_id = p_account and l.owner_id = auth.uid();
  select coalesce(array_agg(distinct e.entry_id) filter (where e.entry_id is not null), '{}') into v_entries
  from public.events e where e.id = any (v_events);

  delete from public.events where id = any (v_events) and owner_id = auth.uid();
  get diagnostics n_events = row_count;
  delete from public.price_quotes where entry_id = any (v_entries) and owner_id = auth.uid();
  delete from public.manual_valuations where (account_id = p_account or entry_id = any (v_entries)) and owner_id = auth.uid();
  get diagnostics n_values = row_count;
  delete from public.accounts where id = p_account and owner_id = auth.uid();
  -- A broker without accounts is gone too.
  delete from public.institutions i
  where i.id = a.institution_id and i.owner_id = auth.uid()
    and not exists (select 1 from public.accounts x where x.institution_id = i.id);
  return jsonb_build_object('events', n_events, 'valuations', n_values);
end $$;

create function public.delete_instrument(p_instrument uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.trusted_owner() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.instruments where id = p_instrument and owner_id = auth.uid()) then
    raise exception 'unknown_instrument' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.lines where instrument_id = p_instrument) then
    raise exception 'instrument_in_use' using errcode = '23503';
  end if;
  delete from public.price_quotes where instrument_id = p_instrument and owner_id = auth.uid();
  delete from public.manual_valuations where instrument_id = p_instrument and owner_id = auth.uid();
  delete from public.instruments where id = p_instrument and owner_id = auth.uid();
end $$;

revoke all on function public.write_entry(jsonb, timestamptz), public.record_entry(jsonb), public.delete_entry(uuid),
  public.replace_entry(uuid, jsonb), public.delete_account(uuid, text), public.delete_instrument(uuid) from public, anon;
grant execute on function public.write_entry(jsonb, timestamptz), public.record_entry(jsonb), public.delete_entry(uuid),
  public.replace_entry(uuid, jsonb), public.delete_account(uuid, text), public.delete_instrument(uuid) to authenticated;
