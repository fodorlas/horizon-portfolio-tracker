-- Ledger core (plan §2–§3). Mirrors src/lib/finance/{ledger,fx,prices}.ts; the
-- shared cases in tests/fixtures/*.json keep both sides identical.

------------------------------------------------------------------------------
-- 1. Instruments
------------------------------------------------------------------------------
create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  asset_class text not null check (asset_class in ('stock', 'etf', 'fund', 'bond', 'managed', 'other')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  ticker text check (ticker is null or length(ticker) between 1 and 32),
  isin text check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  exchange text check (exchange is null or length(exchange) <= 32),
  valuation text not null default 'market' check (valuation in ('market', 'manual')),
  price_source text not null default 'manual' check (price_source in ('manual', 'yahoo', 'finnhub', 'akk', 'bamosz')),
  provider_symbol text check (provider_symbol is null or length(provider_symbol) <= 64),
  stale_after_days int check (stale_after_days between 1 and 3650),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
select private.secure_personal_table('public.instruments', false);

------------------------------------------------------------------------------
-- 2. Events and lines
------------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_type text not null check (event_type in (
    'buy', 'sell', 'dividend', 'dividend_reinvest', 'split', 'fx_exchange', 'deposit', 'withdrawal',
    'transfer', 'fee', 'interest', 'opening_balance', 'correction')),
  event_date date not null,
  correction_kind text check (correction_kind in ('missing_flow', 'reconciliation')),
  split_ratio numeric(28, 10),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
select private.secure_personal_table('public.events', false);

create table public.lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid not null,
  account_id uuid not null,
  instrument_id uuid, -- required for positions; on cash lines it names the payer
  kind text not null check (kind in ('position', 'cash')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(28, 10) not null check (amount <> 0),
  role text not null check (role in ('trade', 'fee', 'tax', 'income', 'external', 'transfer', 'fx', 'split', 'opening', 'correction')),
  cost_amount numeric(28, 10),
  cost_estimated boolean not null default false,
  cost_fx_refs jsonb,
  foreign key (event_id, owner_id) references public.events (id, owner_id) on delete cascade,
  foreign key (account_id, owner_id) references public.accounts (id, owner_id),
  foreign key (instrument_id, owner_id) references public.instruments (id, owner_id)
);
create index lines_event_idx on public.lines (event_id);
create index lines_position_idx on public.lines (account_id, instrument_id) where kind = 'position';
select private.secure_personal_table('public.lines', false);

------------------------------------------------------------------------------
-- 3. Append-only logs: prices and manual valuations (plan §3.3)
------------------------------------------------------------------------------
create table public.price_quotes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  instrument_id uuid not null,
  price numeric(28, 10) not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  as_of timestamptz not null,
  entered_at timestamptz not null default now(),
  source text not null check (source in ('manual', 'yahoo', 'finnhub', 'akk', 'bamosz')),
  status text not null default 'ok' check (status in ('ok', 'suspect')),
  supersedes_id uuid references public.price_quotes (id),
  note text check (note is null or length(note) <= 500),
  check (source <> 'manual' or (note is not null and status = 'ok')),
  check (supersedes_id is null or source = 'manual'),
  foreign key (instrument_id, owner_id) references public.instruments (id, owner_id)
);
create index price_quotes_lookup on public.price_quotes (instrument_id, as_of desc);
select private.secure_personal_table('public.price_quotes', true);

create table public.manual_valuations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null,
  instrument_id uuid not null,
  value numeric(28, 10) not null check (value >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  as_of timestamptz not null,
  entered_at timestamptz not null default now(),
  source text not null default 'manual' check (source = 'manual'),
  status text not null default 'ok' check (status = 'ok'),
  supersedes_id uuid references public.manual_valuations (id),
  note text check (note is null or length(note) <= 500),
  foreign key (account_id, owner_id) references public.accounts (id, owner_id),
  foreign key (instrument_id, owner_id) references public.instruments (id, owner_id)
);
select private.secure_personal_table('public.manual_valuations', true);

-- Broker rates belong to one FX-exchange event (plan §3.1).
alter table public.fx_rates add column event_id uuid references public.events (id) on delete cascade;
alter table public.fx_rates add constraint fx_rates_broker_event check ((source = 'broker') = (event_id is not null));
alter table public.fx_rates add constraint fx_rates_supersedes_manual check (supersedes_id is null or source = 'manual');

-- A correction must describe the same slot it replaces.
create function private.check_supersedes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if new.supersedes_id is null then return new; end if;
  if tg_table_name = 'fx_rates' then
    select base, quote, rate_date, source into t from public.fx_rates where id = new.supersedes_id;
    if t.source = 'broker' or t.base <> new.base or t.quote <> new.quote or t.rate_date <> new.rate_date then
      raise exception 'supersedes_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'price_quotes' then
    select instrument_id, as_of into t from public.price_quotes where id = new.supersedes_id;
    if t.instrument_id <> new.instrument_id or t.as_of <> new.as_of then
      raise exception 'supersedes_mismatch' using errcode = '23514';
    end if;
  else
    select account_id, instrument_id, as_of into t from public.manual_valuations where id = new.supersedes_id;
    if t.account_id <> new.account_id or t.instrument_id <> new.instrument_id or t.as_of <> new.as_of then
      raise exception 'supersedes_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger check_supersedes before insert on public.fx_rates for each row execute function private.check_supersedes();
create trigger check_supersedes before insert on public.price_quotes for each row execute function private.check_supersedes();
create trigger check_supersedes before insert on public.manual_valuations for each row execute function private.check_supersedes();

------------------------------------------------------------------------------
-- 4. Audit trail for changes to personal records (plan §1, audit_log)
------------------------------------------------------------------------------
create trigger audit after insert or update or delete on public.institutions for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.accounts for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.instruments for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.events for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.lines for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- 5. Event validation: the same rules as validateEvent() in ledger.ts.
------------------------------------------------------------------------------
create function private.event_errors(p_event uuid) returns text[]
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
  return errs;
end $$;

-- Quantity history of one position: never below zero; a split line must equal
-- the quantity before it × (ratio − 1). Same order as runLedger().
create function private.position_history_errors(p_account uuid, p_instrument uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  with h as (
    select l.amount, e.event_type, e.split_ratio,
           sum(l.amount) over (order by e.event_date, e.created_at, e.id, l.id rows unbounded preceding) as running
    from public.lines l join public.events e on e.id = l.event_id
    where l.account_id = p_account and l.instrument_id = p_instrument and l.kind = 'position'
  )
  select coalesce(array_agg(distinct err), '{}') from (
    select 'insufficient_quantity' as err from h where running < 0
    union all
    select 'split_amount_mismatch' from h
    where event_type = 'split' and amount <> round((running - amount) * (split_ratio - 1), 10)
  ) x
$$;

create function private.trg_check_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
  errs text[];
  r record;
begin
  -- NEW/OLD fields are only touched inside branches where they exist.
  if tg_table_name = 'events' then
    v_event := new.id;
  elsif tg_op = 'DELETE' then
    v_event := old.event_id;
  else
    v_event := new.event_id;
  end if;

  errs := private.event_errors(v_event);
  if cardinality(errs) > 0 then
    raise exception 'invalid_event: %', array_to_string(errs, ',') using errcode = '23514';
  end if;

  for r in
    select distinct account_id, instrument_id from public.lines
    where event_id = v_event and kind = 'position' and instrument_id is not null
  loop
    errs := private.position_history_errors(r.account_id, r.instrument_id);
    if cardinality(errs) > 0 then
      raise exception 'invalid_history: %', array_to_string(errs, ',') using errcode = '23514';
    end if;
  end loop;

  -- A removed or moved position line can break the history it left behind.
  if tg_table_name = 'lines' then
    if tg_op <> 'INSERT' then
      if old.kind = 'position' and old.instrument_id is not null then
        errs := private.position_history_errors(old.account_id, old.instrument_id);
        if cardinality(errs) > 0 then
          raise exception 'invalid_history: %', array_to_string(errs, ',') using errcode = '23514';
        end if;
      end if;
    end if;
  end if;
  return null;
end $$;

create constraint trigger check_event after insert or update on public.events
  deferrable initially deferred for each row execute function private.trg_check_event();
create constraint trigger check_event after insert or update or delete on public.lines
  deferrable initially deferred for each row execute function private.trg_check_event();

------------------------------------------------------------------------------
-- 6. Recording an event atomically (security invoker: RLS applies).
------------------------------------------------------------------------------
create function public.record_event(p_event jsonb, p_lines jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  -- Event and lines are checked together, whatever mode an earlier call left.
  set constraints all deferred;
  insert into public.events (event_type, event_date, correction_kind, split_ratio, note)
  values (p_event ->> 'type', (p_event ->> 'date')::date, p_event ->> 'correctionKind',
          nullif(p_event ->> 'splitRatio', '')::numeric, p_event ->> 'note')
  returning id into v_id;

  insert into public.lines (event_id, account_id, instrument_id, kind, currency, amount, role,
                            cost_amount, cost_estimated, cost_fx_refs)
  select v_id, (x ->> 'accountId')::uuid, nullif(x ->> 'instrumentId', '')::uuid, x ->> 'kind', x ->> 'currency',
         (x ->> 'amount')::numeric, x ->> 'role', nullif(x ->> 'costAmount', '')::numeric,
         coalesce((x ->> 'costEstimated')::boolean, false), x -> 'costFxRefs'
  from jsonb_array_elements(p_lines) x;

  -- Validate now for a clear error instead of at commit.
  set constraints all immediate;
  return v_id;
end $$;
revoke all on function public.record_event(jsonb, jsonb) from public, anon;
grant execute on function public.record_event(jsonb, jsonb) to authenticated;

------------------------------------------------------------------------------
-- 7. Selection rules in SQL (same as fx.ts / prices.ts)
------------------------------------------------------------------------------
-- Rows as they count: corrections take the superseded slot; broker, suspect and
-- superseded rows drop out.
create view public.fx_effective with (security_invoker = true) as
select r.id,
       coalesce(t.base, r.base)::text as base,
       coalesce(t.quote, r.quote)::text as quote,
       r.rate,
       coalesce(t.rate_date, r.rate_date) as rate_date,
       case when r.source = 'manual' and t.id is not null then t.source else r.source end as source,
       r.fetched_at
from public.fx_rates r
left join public.fx_rates t on t.id = r.supersedes_id and r.source = 'manual' and t.source <> 'broker'
where r.source <> 'broker' and r.status = 'ok'
  and not exists (select 1 from public.fx_rates c where c.supersedes_id = r.id and c.status = 'ok' and c.source = 'manual');
revoke all on public.fx_effective from anon;

create function public.fx_leg(p_source text, p_day date, p_from text, p_to text,
                              out rate numeric, out row_id uuid, out method text)
language sql stable security invoker set search_path = '' as $$
  select x.rate, x.id, x.method from (
    (select e.rate, e.id, 'direct' as method, 1 as pri, e.fetched_at from public.fx_effective e
      where e.source = p_source and e.rate_date = p_day and e.base = p_from and e.quote = p_to
      order by e.fetched_at desc limit 1)
    union all
    (select 1 / e.rate, e.id, 'inverse', 2, e.fetched_at from public.fx_effective e
      where e.source = p_source and e.rate_date = p_day and e.base = p_to and e.quote = p_from
      order by e.fetched_at desc limit 1)
  ) x order by x.pri limit 1
$$;

create function public.select_fx(p_from text, p_to text, p_day date)
returns table (kind text, rate numeric, method text, source text, rate_date date, row_ids uuid[], via text)
language plpgsql stable security invoker set search_path = '' as $$
declare
  src text;
  d date;
  a record;
  b record;
  piv text;
begin
  if p_from = p_to then
    return query select 'identity'::text, 1::numeric, null::text, null::text, null::date, '{}'::uuid[], null::text;
    return;
  end if;
  foreach src in array array['MNB', 'ECB', 'manual'] loop
    for d in
      select distinct e.rate_date from public.fx_effective e
      where e.source = src and e.rate_date between p_day - 10 and p_day
      order by 1 desc
    loop
      select * into a from public.fx_leg(src, d, p_from, p_to);
      if a.rate is not null then
        return query select 'rate'::text, a.rate, a.method, src, d, array[a.row_id], null::text;
        return;
      end if;
      foreach piv in array case src when 'MNB' then array['HUF'] when 'ECB' then array['EUR'] else array['HUF', 'EUR'] end loop
        continue when piv = p_from or piv = p_to;
        select * into a from public.fx_leg(src, d, p_from, piv);
        select * into b from public.fx_leg(src, d, piv, p_to);
        if a.rate is not null and b.rate is not null then
          return query select 'rate'::text, a.rate * b.rate, 'cross'::text, src, d, array[a.row_id, b.row_id], piv;
          return;
        end if;
      end loop;
    end loop;
  end loop;
  return query select 'missing'::text, null::numeric, null::text, null::text, null::date, '{}'::uuid[], null::text;
end $$;

create function public.select_price(p_instrument uuid, p_day date) returns setof public.price_quotes
language sql stable security invoker set search_path = '' as $$
  select q.* from public.price_quotes q
  where q.instrument_id = p_instrument and q.status = 'ok'
    and (q.as_of at time zone 'Europe/Budapest')::date <= p_day
    and not exists (select 1 from public.price_quotes c
                    where c.supersedes_id = q.id and c.status = 'ok' and c.source = 'manual')
  order by q.as_of desc, (q.source = 'manual') desc, q.entered_at desc
  limit 1
$$;

create function public.select_valuation(p_account uuid, p_instrument uuid, p_day date) returns setof public.manual_valuations
language sql stable security invoker set search_path = '' as $$
  select v.* from public.manual_valuations v
  where v.account_id = p_account and v.instrument_id = p_instrument
    and (v.as_of at time zone 'Europe/Budapest')::date <= p_day
    and not exists (select 1 from public.manual_valuations c where c.supersedes_id = v.id)
  order by v.as_of desc, v.entered_at desc
  limit 1
$$;

revoke all on function public.fx_leg(text, date, text, text), public.select_fx(text, text, date),
  public.select_price(uuid, date), public.select_valuation(uuid, uuid, date) from public, anon;
grant execute on function public.fx_leg(text, date, text, text), public.select_fx(text, text, date),
  public.select_price(uuid, date), public.select_valuation(uuid, uuid, date) to authenticated;

revoke all on function private.event_errors(uuid), private.position_history_errors(uuid, uuid),
  private.trg_check_event(), private.check_supersedes() from public, anon, authenticated, service_role;
