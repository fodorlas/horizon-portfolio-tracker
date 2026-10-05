-- BÉT price source (spec 2026-09-28 §2.6, §12/3; plan 2026-09-28-bet.md, PR A),
-- backward compatible: the app before the BÉT keeps working with this schema
-- (its `yahooQuotes` stay accepted, the new `source` column of price_coverage
-- is extra to it), so the schema goes live before the code that needs it.

------------------------------------------------------------------------------
-- 1. The BÉT as a source of instruments, prices and the refresh log
------------------------------------------------------------------------------
alter table public.instruments drop constraint instruments_price_source_check,
  add constraint instruments_price_source_check check (price_source in ('manual', 'yahoo', 'finnhub', 'akk', 'bamosz', 'bet'));
alter table public.price_quotes drop constraint price_quotes_source_check,
  add constraint price_quotes_source_check check (source in ('manual', 'yahoo', 'finnhub', 'akk', 'bamosz', 'bet'));
alter table public.refresh_log drop constraint refresh_log_source_check,
  add constraint refresh_log_source_check check (source in ('MNB', 'ECB', 'yahoo', 'akk', 'bamosz', 'bet'));

-- One instrument per BÉT code and owner, as with Yahoo symbols.
create unique index instruments_one_per_bet_code on public.instruments (owner_id, upper(provider_symbol)) where price_source = 'bet';

create or replace function public.record_quotes(p_rows jsonb)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
begin
  if exists (select 1 from jsonb_array_elements(p_rows) x where x ->> 'source' not in ('yahoo', 'akk', 'bet')) then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  insert into public.price_quotes (instrument_id, price, currency, as_of, source, status)
  select (x ->> 'instrumentId')::uuid, (x ->> 'price')::numeric, x ->> 'currency',
         (x ->> 'asOf')::timestamptz, x ->> 'source', x ->> 'status'
  from jsonb_array_elements(p_rows) x
  on conflict (instrument_id, source, as_of) where source <> 'manual' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

------------------------------------------------------------------------------
-- 2. Coverage per source: a paper switched from Yahoo to the BÉT still gets
--    its BÉT history.
------------------------------------------------------------------------------
drop function public.price_coverage();
create function public.price_coverage()
returns table (instrument_id uuid, source text, first_day date, last_day date, last_entered timestamptz)
language sql stable security invoker set search_path = '' as $$
  select q.instrument_id,
         q.source,
         min((q.as_of at time zone 'Europe/Budapest')::date),
         max((q.as_of at time zone 'Europe/Budapest')::date),
         max(q.entered_at)
  from public.price_quotes q
  where q.source in ('yahoo', 'bet')
  group by 1, 2
$$;
revoke all on function public.price_coverage() from public, anon;
grant execute on function public.price_coverage() to authenticated;

------------------------------------------------------------------------------
-- 3. Price selection by source (plan §3.3 as extended on 2026-09-28): an
--    instrument's price comes from its own source and manual rows (any
--    source for a manually priced one); a manual correction counts only
--    where the row it corrects counts, all the way down a chain of
--    corrections. The same rule as selectPrice in prices.ts
--    (tests/fixtures/price-selection-cases.json).
--
--    The callers test the source inline and ask price_counts only for
--    corrections, so the chain walk runs for the few correction rows alone.
------------------------------------------------------------------------------
create function private.price_counts(q public.price_quotes, p_price_source text) returns boolean
language sql stable security invoker set search_path = '' as $$
  -- Every row a correction chain leads back to must be from an allowed source
  -- (the corrections in between are manual, so the first corrected row decides).
  with recursive chain as (
    select t.id, t.source, t.supersedes_id from public.price_quotes t where t.id = q.supersedes_id
    union all
    select u.id, u.source, u.supersedes_id from public.price_quotes u join chain c on u.id = c.supersedes_id
  )
  select (p_price_source = 'manual' or q.source in (p_price_source, 'manual'))
     and not exists (select 1 from chain c where not (p_price_source = 'manual' or c.source in (p_price_source, 'manual')))
$$;
-- Minimal rights, as for the other private helpers (security_foundation.sql):
-- nobody but the app role; select_price and price_quotes_from run as the caller.
revoke all on function private.price_counts(public.price_quotes, text) from public, anon, authenticated, service_role;
grant execute on function private.price_counts(public.price_quotes, text) to authenticated;

create or replace function public.select_price(p_instrument uuid, p_day date) returns setof public.price_quotes
language sql stable security invoker set search_path = '' as $$
  select q.* from public.price_quotes q
  join public.instruments i on i.id = q.instrument_id
  where q.instrument_id = p_instrument and q.status = 'ok'
    and (q.as_of at time zone 'Europe/Budapest')::date <= p_day
    and (i.price_source = 'manual' or q.source in (i.price_source, 'manual'))
    and (q.supersedes_id is null or private.price_counts(q, i.price_source))
    and not exists (select 1 from public.price_quotes c
                    where c.supersedes_id = q.id and c.status = 'ok' and c.source = 'manual')
  order by q.as_of desc, (q.source = 'manual') desc, q.entered_at desc
  limit 1
$$;

create or replace function public.price_quotes_from(p_from date)
returns setof public.price_quotes
language sql stable security invoker set search_path = '' as $$
  with start as (select (p_from::timestamp at time zone 'Europe/Budapest') as t),
  anchors as (
    select distinct on (q.instrument_id) q.id
    from public.price_quotes q
    join public.instruments i on i.id = q.instrument_id, start
    where q.as_of < start.t
      and q.status = 'ok'
      and (i.price_source = 'manual' or q.source in (i.price_source, 'manual'))
      and (q.supersedes_id is null or private.price_counts(q, i.price_source))
      and not exists (
        select 1 from public.price_quotes s
        where s.supersedes_id = q.id and s.status = 'ok' and s.source = 'manual'
      )
    order by q.instrument_id, q.as_of desc, (q.source = 'manual') desc, q.entered_at desc
  )
  select q.*
  from public.price_quotes q, start
  where q.as_of >= start.t
     or q.id in (select id from anchors)
$$;

------------------------------------------------------------------------------
-- 4. Entries: the estimate quotes carry their source (Yahoo or BÉT). The
--    body is 20260928120000_akk.sql's, but for that block. (Grants stay from
--    20260927200000.)
------------------------------------------------------------------------------
create or replace function public.write_entry(p jsonb, p_created_at timestamptz) returns uuid[]
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
  -- A government security brings its terms (spec 2026-09-28 §3.1).
  insert into public.bond_terms (instrument_id, series, security_type, tab, issue_date, maturity_date)
  select (x ->> 'id')::uuid, x -> 'bond' ->> 'series', x -> 'bond' ->> 'securityType', x -> 'bond' ->> 'tab',
         (x -> 'bond' ->> 'issueDate')::date, (x -> 'bond' ->> 'maturityDate')::date
  from jsonb_array_elements(coalesce(p -> 'instruments', '[]'::jsonb)) x
  where jsonb_typeof(x -> 'bond') = 'object';

  if jsonb_typeof(p -> 'trackingStart') = 'object' then
    update public.accounts set tracking_start_date = (p -> 'trackingStart' ->> 'day')::date
    where id = (p -> 'trackingStart' ->> 'accountId')::uuid;
    if not found then
      raise exception 'unknown_account' using errcode = '42501';
    end if;
  end if;

  -- Market closes are observations of their own: a repeated one adds nothing.
  -- `quotes` carry their source; `yahooQuotes` is the payload of the app before
  -- the BÉT and stays accepted, so both apps work with this schema.
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'quotes', '[]'::jsonb)) x
             where coalesce(x ->> 'source', '') not in ('yahoo', 'bet')) then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  insert into public.price_quotes (instrument_id, price, currency, as_of, source, status)
  select (x ->> 'instrumentId')::uuid, (x ->> 'price')::numeric, x ->> 'currency', (x ->> 'asOf')::timestamptz, x ->> 'source', 'ok'
  from jsonb_array_elements(coalesce(p -> 'quotes', '[]'::jsonb)) x
  union all
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
      if coalesce(ev ->> 'type', '') not in ('opening_balance', 'deposit', 'buy', 'sell', 'withdrawal',
                                             'interest', 'interest_reinvest', 'maturity') then
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

  -- An approved proposal (spec §6.4): the pending row points at its entry.
  if jsonb_typeof(p -> 'pending') = 'object' then
    if array_length(ids, 1) is distinct from 1 then
      raise exception 'pending_needs_one_entry' using errcode = '22023';
    end if;
    update public.pending_events
    set status = 'approved', entry_id = ids[1], edited = edited or coalesce((p -> 'pending' ->> 'edited')::boolean, false), updated_at = now()
    where id = (p -> 'pending' ->> 'id')::uuid and status in ('open', 'snoozed');
    if not found then
      raise exception 'pending_not_open' using errcode = '22023';
    end if;
  end if;
  return ids;
end $$;
