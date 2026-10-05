-- Government securities from the ÁKK (spec 2026-09-28 §3, §4, §6–§8).
--
--  * Two event types: interest_reinvest (a MÁP Plusz interest credited in
--    papers of the same series) and maturity (the nominal repaid, with the
--    last interest). A maturity leaves nothing of the paper on the account.
--  * bond_terms: the series behind an ÁKK instrument and its self-check.
--  * bond_observations: one ÁKK reading per instrument and day (append-only).
--  * bond_rates: the ÁKK interest history of BMÁP and PMÁP series.
--  * pending_events: the Horizon's proposals ("Ellenőrzésre vár"); nothing
--    enters the ledger until the owner approves one (write_entry's pending).
--  * sync_pending_events: the refresh's computed list in, one call.

------------------------------------------------------------------------------
-- 1. Event types and their shapes
------------------------------------------------------------------------------
alter table public.events drop constraint events_event_type_check,
  add constraint events_event_type_check check (event_type in (
    'buy', 'sell', 'dividend', 'dividend_reinvest', 'split', 'fx_exchange', 'deposit', 'withdrawal',
    'transfer', 'fee', 'interest', 'opening_balance', 'correction', 'interest_reinvest', 'maturity'));

create or replace function private.event_errors(p_event uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.events;
  errs text[] := '{}';
  c record;
  shape boolean;
begin
  select * into e from public.events where id = p_event;
  if not found then return '{}'; end if;

  select
    count(*) as n_all,
    count(*) filter (where kind = 'position') as n_pos,
    count(*) filter (where kind = 'position' and role = 'trade' and amount > 0) as pt_pos,
    count(*) filter (where kind = 'position' and role = 'trade' and amount > 0 and cost_amount is null) as pt_pos_nocost,
    count(*) filter (where kind = 'position' and role = 'trade' and amount < 0) as pt_neg,
    count(*) filter (where kind = 'position' and cost_amount is not null) as pos_cost,
    count(*) filter (where kind = 'position' and cost_amount is null) as pos_nocost,
    count(*) filter (where kind = 'cash' and role = 'trade' and amount < 0) as ct_neg,
    count(*) filter (where kind = 'cash' and role = 'trade' and amount > 0) as ct_pos,
    count(*) filter (where kind = 'cash' and role = 'income' and amount > 0) as ci_pos,
    count(*) filter (where kind = 'cash' and role in ('fee', 'tax') and amount < 0) as feetax,
    count(*) filter (where kind = 'position' and role = 'split') as ps,
    count(*) filter (where kind = 'position' and role = 'split' and cost_amount is not null) as ps_cost,
    count(*) filter (where kind = 'cash' and role = 'fx') as cfx,
    count(*) filter (where kind = 'cash' and role = 'fx' and amount > 0) as cfx_pos,
    count(*) filter (where kind = 'cash' and role = 'fx' and amount < 0) as cfx_neg,
    count(distinct currency) filter (where kind = 'cash' and role = 'fx') as cfx_ccy,
    count(distinct account_id) filter (where kind = 'cash' and role = 'fx') as cfx_acct,
    count(*) filter (where kind = 'cash' and role = 'external') as cext,
    count(*) filter (where kind = 'cash' and role = 'external' and amount > 0) as cext_pos,
    count(*) filter (where kind = 'cash' and role = 'external' and amount < 0) as cext_neg,
    count(*) filter (where role = 'transfer') as tr,
    count(distinct account_id) filter (where role = 'transfer') as tr_acct,
    count(*) filter (where role = 'transfer' and cost_amount is not null) as tr_cost,
    count(*) filter (where role = 'opening' and amount > 0) as op_pos,
    count(*) filter (where role = 'correction') as corr,
    count(*) filter (where role = 'correction' and kind = 'position' and (
      (amount > 0 and (cost_amount is null or not cost_estimated)) or (amount < 0 and cost_amount is not null))) as corr_bad
  into c
  from public.lines where event_id = p_event;

  if c.n_all = 0 then return array['no_lines']; end if;

  if (e.event_type = 'correction') <> (e.correction_kind is not null) then errs := array_append(errs, 'correction_kind_mismatch'); end if;
  if (e.event_type = 'split') <> coalesce(e.split_ratio > 0 and e.split_ratio <> 1, false) then errs := array_append(errs, 'split_ratio_mismatch'); end if;
  if e.event_type = 'correction' and coalesce(btrim(e.note), '') = '' then errs := array_append(errs, 'note_required'); end if;

  if exists (select 1 from public.lines where event_id = p_event and kind = 'position' and instrument_id is null) then
    errs := array_append(errs, 'position_without_instrument');
  end if;
  if exists (select 1 from public.lines l join public.instruments i on i.id = l.instrument_id
             where l.event_id = p_event and l.kind = 'position' and i.currency <> l.currency) then
    errs := array_append(errs, 'position_currency_mismatch');
  end if;
  if exists (select 1 from public.lines where event_id = p_event and kind = 'cash' and cost_amount is not null) then
    errs := array_append(errs, 'cost_on_cash_line');
  end if;
  if exists (select 1 from public.lines where event_id = p_event and cost_amount < 0) then
    errs := array_append(errs, 'negative_cost');
  end if;
  if e.event_type = 'opening_balance' and exists (
      select 1 from public.lines l join public.accounts a on a.id = l.account_id
      where l.event_id = p_event and a.tracking_start_date <> e.event_date) then
    errs := array_append(errs, 'opening_not_on_tracking_start');
  end if;
  if e.event_type <> 'opening_balance' and exists (
      select 1 from public.lines l join public.accounts a on a.id = l.account_id
      where l.event_id = p_event and e.event_date <= a.tracking_start_date) then
    errs := array_append(errs, 'before_tracking_start');
  end if;

  shape := case e.event_type
    when 'buy' then c.pt_pos = 1 and c.pt_pos_nocost = 0 and c.ct_neg >= 1 and c.n_all = c.pt_pos + c.ct_neg + c.feetax
    when 'sell' then c.pt_neg = 1 and c.pos_cost = 0 and c.ct_pos >= 1 and c.n_all = c.pt_neg + c.ct_pos + c.feetax
    when 'dividend' then c.ci_pos >= 1 and c.n_all = c.ci_pos + c.feetax
    when 'interest' then c.ci_pos >= 1 and c.n_all = c.ci_pos + c.feetax
    when 'dividend_reinvest' then c.ci_pos >= 1 and c.ct_neg >= 1 and c.pt_pos = 1 and c.pos_nocost = 0
                                  and c.n_all = c.ci_pos + c.ct_neg + c.pt_pos + c.feetax
    when 'interest_reinvest' then c.ci_pos >= 1 and c.ct_neg >= 1 and c.pt_pos = 1 and c.pos_nocost = 0
                                  and c.n_all = c.ci_pos + c.ct_neg + c.pt_pos + c.feetax
    when 'maturity' then c.pt_neg = 1 and c.pos_cost = 0 and c.ct_pos >= 1
                         and c.n_all = c.pt_neg + c.ct_pos + c.ci_pos + c.feetax
    when 'split' then c.n_all = 1 and c.ps = 1 and c.ps_cost = 0
    when 'fx_exchange' then c.cfx = 2 and c.cfx_ccy = 2 and c.cfx_acct = 1 and c.cfx_pos = 1 and c.cfx_neg = 1
                            and c.n_all = c.cfx + c.feetax
    when 'deposit' then c.n_all = 1 and c.cext_pos = 1
    when 'withdrawal' then c.n_all = 1 and c.cext_neg = 1
    when 'fee' then c.n_all = c.feetax and not exists (
                      select 1 from public.lines where event_id = p_event and not (kind = 'cash' and role in ('fee', 'tax')))
    when 'transfer' then c.n_all = c.tr and c.tr_acct >= 2 and c.tr_cost = 0 and not exists (
                           select 1 from public.lines where event_id = p_event
                           group by kind, case when kind = 'position' then instrument_id::text else currency end
                           having sum(amount) <> 0)
    when 'opening_balance' then c.n_all = c.op_pos and c.pos_nocost = 0
    when 'correction' then case e.correction_kind
                             when 'missing_flow' then c.n_all = 1 and c.cext = 1
                             else c.n_all = c.corr and c.corr_bad = 0 end
    else false
  end;
  if not coalesce(shape, false) then errs := array_append(errs, 'bad_shape'); end if;
  -- A maturity repays the whole holding: nothing of the paper is left on that account.
  if e.event_type = 'maturity' and exists (
      select 1 from public.lines m
      where m.event_id = p_event and m.kind = 'position'
        and (select coalesce(sum(l.amount), 0) from public.lines l join public.events x on x.id = l.event_id
             where l.kind = 'position' and l.account_id = m.account_id and l.instrument_id = m.instrument_id
               and x.event_date <= e.event_date) <> 0) then
    errs := array_append(errs, 'maturity_leaves_units');
  end if;
  return errs;
end $$;

------------------------------------------------------------------------------
-- 2. The refresh log and the price log learn the ÁKK
------------------------------------------------------------------------------
alter table public.refresh_log drop constraint refresh_log_source_check,
  add constraint refresh_log_source_check check (source in ('MNB', 'ECB', 'yahoo', 'akk', 'bamosz'));
alter table public.refresh_log drop constraint refresh_log_message_check,
  add constraint refresh_log_message_check check (message is null or message in (
    'timeout', 'http_429', 'http_5xx', 'http_4xx', 'symbol_not_found', 'network', 'parse', 'budget', 'rate_limited',
    'rule_mismatch', 'not_listed'));

create or replace function public.record_quotes(p_rows jsonb)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
begin
  if exists (select 1 from jsonb_array_elements(p_rows) x where x ->> 'source' not in ('yahoo', 'akk')) then
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

-- One instrument per series and owner, as with Yahoo symbols.
create unique index instruments_one_per_akk_series on public.instruments (owner_id, provider_symbol) where price_source = 'akk';

------------------------------------------------------------------------------
-- 3. Bond tables (personal, RLS: the standard policy set)
------------------------------------------------------------------------------
create table public.bond_terms (
  instrument_id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  series text not null check (length(series) between 1 and 32),
  security_type text not null check (security_type in ('MÁP Plusz', 'MÁPP_T', 'FixMÁP', 'PMÁP', 'BMÁP')),
  tab text not null check (tab in ('MAP', 'MAPP')),
  issue_date date not null,
  maturity_date date not null,
  check_status text not null default 'unknown' check (check_status in ('unknown', 'verified', 'mismatch')),
  checked_on date,
  check (issue_date < maturity_date),
  foreign key (instrument_id, owner_id) references public.instruments (id, owner_id) on delete cascade
);
select private.secure_personal_table('public.bond_terms', false);

create table public.bond_observations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  instrument_id uuid not null,
  day date not null,
  bid numeric(12, 4) not null check (bid > 0),
  ask numeric(12, 4) check (ask is null or ask > 0),
  accrued numeric(12, 4) not null check (accrued >= 0),
  coupon numeric(8, 4),
  settle_date date not null,
  check_result text not null check (check_result in ('ok', 'mismatch', 'no_rate')),
  unique (instrument_id, day),
  foreign key (instrument_id, owner_id) references public.instruments (id, owner_id) on delete cascade
);
select private.secure_personal_table('public.bond_observations', true);

-- Only the ÁKK history lives here (spec §8 also named a source column with
-- akk_history | akk_live); the coupon a refresh saw is read from bond_observations.
create table public.bond_rates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  series text not null check (length(series) between 1 and 32),
  period_start date not null,
  period_end date not null,
  rate numeric(8, 4) not null,
  check (period_start < period_end),
  unique (owner_id, series, period_start)
);
select private.secure_personal_table('public.bond_rates', true);

create table public.pending_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  instrument_id uuid not null,
  account_id uuid not null,
  kind text not null check (kind in ('interest_reinvest', 'interest', 'maturity')),
  due_date date not null,
  nominal numeric(28, 10) not null check (nominal > 0),
  percent numeric(8, 2),
  amount numeric(28, 10) check (amount is null or amount >= 0),
  basis jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'snoozed', 'approved', 'dismissed')),
  edited boolean not null default false,
  entry_id uuid,
  updated_at timestamptz not null default now(),
  check ((status = 'approved') = (entry_id is not null)),
  unique (owner_id, instrument_id, account_id, kind, due_date),
  foreign key (instrument_id, owner_id) references public.instruments (id, owner_id) on delete cascade,
  foreign key (account_id, owner_id) references public.accounts (id, owner_id) on delete cascade
);
create index pending_events_entry_idx on public.pending_events (entry_id) where entry_id is not null;
select private.secure_personal_table('public.pending_events', false);

------------------------------------------------------------------------------
-- 4. The refresh's proposals in one call (security invoker: own rows only).
--    New keys come in open; open or snoozed rows the owner did not edit take
--    the new figures; open or snoozed rows no longer computed go. Approved
--    and dismissed rows are the owner's decisions and stay as they are.
------------------------------------------------------------------------------
create function public.sync_pending_events(p_rows jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  n integer := 0;
  k integer;
begin
  insert into public.pending_events as p (instrument_id, account_id, kind, due_date, nominal, percent, amount, basis)
  select (x ->> 'instrumentId')::uuid, (x ->> 'accountId')::uuid, x ->> 'kind', (x ->> 'due')::date,
         (x ->> 'nominal')::numeric, nullif(x ->> 'percent', '')::numeric, nullif(x ->> 'amount', '')::numeric,
         coalesce(x -> 'basis', '{}'::jsonb)
  from jsonb_array_elements(p_rows) x
  on conflict (owner_id, instrument_id, account_id, kind, due_date) do update
    set nominal = excluded.nominal, percent = excluded.percent, amount = excluded.amount, basis = excluded.basis, updated_at = now()
    where p.status in ('open', 'snoozed') and not p.edited
      and (p.nominal, p.percent, p.amount, p.basis) is distinct from (excluded.nominal, excluded.percent, excluded.amount, excluded.basis);
  get diagnostics k = row_count;
  n := n + k;

  delete from public.pending_events p
  where p.owner_id = auth.uid() and p.status in ('open', 'snoozed')
    and not exists (
      select 1 from jsonb_array_elements(p_rows) x
      where (x ->> 'instrumentId')::uuid = p.instrument_id and (x ->> 'accountId')::uuid = p.account_id
        and x ->> 'kind' = p.kind and (x ->> 'due')::date = p.due_date);
  get diagnostics k = row_count;
  return n + k;
end $$;
revoke all on function public.sync_pending_events(jsonb) from public, anon;
grant execute on function public.sync_pending_events(jsonb) to authenticated;

------------------------------------------------------------------------------
-- 5. Entries: bond terms, the new event types, approvals; a deleted approval
--    sends its proposal back. (Grants stay from 20260927200000.)
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

create or replace function public.delete_entry(p_entry uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not private.trusted_owner() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- A deleted approval sends its proposal back to the list (spec §6.2).
  -- It is a proposal again: the owner's earlier edit went with the entry, so the refresh may update it.
  update public.pending_events set status = 'open', entry_id = null, edited = false, updated_at = now()
  where entry_id = p_entry and owner_id = auth.uid();
  delete from public.events where entry_id = p_entry and owner_id = auth.uid();
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'unknown_entry' using errcode = 'P0002';
  end if;
  delete from public.price_quotes where entry_id = p_entry and owner_id = auth.uid();
  delete from public.manual_valuations where entry_id = p_entry and owner_id = auth.uid();
  return n;
end $$;
