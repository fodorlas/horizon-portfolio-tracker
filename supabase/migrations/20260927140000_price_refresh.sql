-- Phase 4a: price and FX refresh (phase 4 plan §2–§3).
--
--  * price_quotes: one automatic row per (instrument, source, moment), so a
--    repeated refresh adds nothing.
--  * refresh_log: one row per fetched item – what was asked, what came back.
--    The message can only be an error class, never provider content.
--  * record_fx_rates / record_quotes: bulk insert of automatic rows, "on
--    conflict do nothing", under the caller's RLS (security invoker).
--  * fx_coverage / price_coverage: what is already stored, per item, so a
--    refresh fetches only what is missing.
--  * price_quotes_from: the prices needed from a day on – that window and the
--    last valid price before it per instrument – so pages do not load years
--    of daily closes (plan §1, "Betöltés").

------------------------------------------------------------------------------
-- 1. One automatic row per instrument, source and moment
------------------------------------------------------------------------------
create unique index price_quotes_one_per_source_moment
  on public.price_quotes (instrument_id, source, as_of)
  where source <> 'manual';

------------------------------------------------------------------------------
-- 2. The refresh log
------------------------------------------------------------------------------
create table public.refresh_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  run_id uuid not null,
  source text not null check (source in ('MNB', 'ECB', 'yahoo')),
  item text not null check (length(item) between 1 and 64),
  kind text not null check (kind in ('history', 'tail', 'live')),
  range_from date,
  range_to date,
  status text not null check (status in ('ok', 'empty', 'error', 'skipped')),
  inserted integer not null default 0 check (inserted >= 0),
  suspect integer not null default 0 check (suspect >= 0),
  unchecked integer not null default 0 check (unchecked >= 0),
  message text check (message is null or message in (
    'timeout', 'http_429', 'http_5xx', 'http_4xx', 'symbol_not_found', 'network', 'parse', 'budget', 'rate_limited'
  )),
  at timestamptz not null default now(),
  check (range_from is null or range_to is null or range_from <= range_to),
  check (status <> 'ok' or message is null),
  check (status <> 'error' or message is not null)
);
create index refresh_log_recent on public.refresh_log (owner_id, at desc);
create index refresh_log_item on public.refresh_log (owner_id, source, item, kind, at desc);
select private.secure_personal_table('public.refresh_log', true);

------------------------------------------------------------------------------
-- 3. Bulk insert of automatic rows
------------------------------------------------------------------------------
create function public.record_fx_rates(p_rows jsonb)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
begin
  if exists (select 1 from jsonb_array_elements(p_rows) x where x ->> 'source' not in ('MNB', 'ECB')) then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  insert into public.fx_rates (base, quote, rate, rate_date, source, raw_unit, status)
  select x ->> 'base', x ->> 'quote', (x ->> 'rate')::numeric, (x ->> 'rateDate')::date,
         x ->> 'source', (x ->> 'rawUnit')::integer, x ->> 'status'
  from jsonb_array_elements(p_rows) x
  on conflict (base, quote, rate_date, source) where source in ('MNB', 'ECB') do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.record_fx_rates(jsonb) from public, anon;
grant execute on function public.record_fx_rates(jsonb) to authenticated;

create function public.record_quotes(p_rows jsonb)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
begin
  if exists (select 1 from jsonb_array_elements(p_rows) x where x ->> 'source' <> 'yahoo') then
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
revoke all on function public.record_quotes(jsonb) from public, anon;
grant execute on function public.record_quotes(jsonb) to authenticated;

------------------------------------------------------------------------------
-- 4. What is stored, per refresh item (RLS applies: own prices, trusted FX)
------------------------------------------------------------------------------
create function public.fx_coverage()
returns table (source text, currency text, first_day date, last_day date)
language sql stable security invoker set search_path = '' as $$
  select r.source, case when r.source = 'MNB' then r.base else r.quote end, min(r.rate_date), max(r.rate_date)
  from public.fx_rates r
  where (r.source = 'MNB' and r.quote = 'HUF') or (r.source = 'ECB' and r.base = 'EUR')
  group by 1, 2
$$;
revoke all on function public.fx_coverage() from public, anon;
grant execute on function public.fx_coverage() to authenticated;

create function public.price_coverage()
returns table (instrument_id uuid, first_day date, last_day date, last_entered timestamptz)
language sql stable security invoker set search_path = '' as $$
  select q.instrument_id,
         min((q.as_of at time zone 'Europe/Budapest')::date),
         max((q.as_of at time zone 'Europe/Budapest')::date),
         max(q.entered_at)
  from public.price_quotes q
  where q.source = 'yahoo'
  group by 1
$$;
revoke all on function public.price_coverage() from public, anon;
grant execute on function public.price_coverage() to authenticated;

------------------------------------------------------------------------------
-- 5. Prices from a day on (the same choice as selectLogged in prices.ts):
--    every row from the start of p_from (Budapest) on, and the row that wins
--    just before it per instrument. A correction always has the as_of of the
--    row it replaces (check_supersedes), so both fall on the same side.
------------------------------------------------------------------------------
create function public.price_quotes_from(p_from date)
returns setof public.price_quotes
language sql stable security invoker set search_path = '' as $$
  with start as (select (p_from::timestamp at time zone 'Europe/Budapest') as t),
  anchors as (
    select distinct on (q.instrument_id) q.id
    from public.price_quotes q, start
    where q.as_of < start.t
      and q.status = 'ok'
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
revoke all on function public.price_quotes_from(date) from public, anon;
grant execute on function public.price_quotes_from(date) to authenticated;
