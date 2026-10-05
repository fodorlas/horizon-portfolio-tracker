-- Recording an event together with the rows that belong to it (plan §1.5:
-- several rows → one Postgres function, one transaction, security invoker).
--
--  * fx_exchange: the actual rate is stored as a `broker` fx_rates row tied to
--    the event (plan §3.1). It is derived from the event's own two fx lines, so
--    it can never disagree with them: 1 unit of the sold currency = rate units
--    of the bought one.
--  * extras.quotes / extras.valuations: manual prices or values that the event
--    needs, e.g. the opening price on the tracking-start day (plan §2).
--
-- Everything runs under the caller's RLS; any failure rolls back the event too.

create function public.record_event_bundle(p_event jsonb, p_lines jsonb, p_extras jsonb default '{}'::jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_sold record;
  v_bought record;
begin
  v_id := public.record_event(p_event, p_lines);

  if p_event ->> 'type' = 'fx_exchange' then
    -- record_event has validated the shape: exactly one negative and one positive fx line.
    select currency, amount into v_sold from public.lines where event_id = v_id and role = 'fx' and amount < 0;
    select currency, amount into v_bought from public.lines where event_id = v_id and role = 'fx' and amount > 0;
    insert into public.fx_rates (base, quote, rate, rate_date, source, event_id, note)
    values (v_sold.currency, v_bought.currency, v_bought.amount / -v_sold.amount,
            (p_event ->> 'date')::date, 'broker', v_id, null);
  end if;

  insert into public.price_quotes (instrument_id, price, currency, as_of, source, note)
  select (x ->> 'instrumentId')::uuid, (x ->> 'price')::numeric, x ->> 'currency',
         (x ->> 'asOf')::timestamptz, 'manual', x ->> 'note'
  from jsonb_array_elements(coalesce(p_extras -> 'quotes', '[]'::jsonb)) x;

  insert into public.manual_valuations (account_id, instrument_id, value, currency, as_of, note)
  select (x ->> 'accountId')::uuid, (x ->> 'instrumentId')::uuid, (x ->> 'value')::numeric,
         x ->> 'currency', (x ->> 'asOf')::timestamptz, x ->> 'note'
  from jsonb_array_elements(coalesce(p_extras -> 'valuations', '[]'::jsonb)) x;

  return v_id;
end $$;

revoke all on function public.record_event_bundle(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.record_event_bundle(jsonb, jsonb, jsonb) to authenticated;
