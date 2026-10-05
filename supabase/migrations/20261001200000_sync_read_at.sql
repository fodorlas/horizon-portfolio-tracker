-- The refresh's proposal sync works from the data it read at its start
-- (#92). A proposal that changed after that read – above all one a "send
-- back" (delete_entry) has just reopened – is no longer deleted only because
-- the older read did not list it; the next refresh decides on it.
--
-- Backward compatible: p_read_at defaults to null, and null keeps the old
-- rule, so the app before this change calls it unchanged (one argument).

drop function public.sync_pending_events(jsonb);

create function public.sync_pending_events(p_rows jsonb, p_read_at timestamptz default null) returns integer
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
    and (p_read_at is null or p.updated_at < p_read_at)
    and not exists (
      select 1 from jsonb_array_elements(p_rows) x
      where (x ->> 'instrumentId')::uuid = p.instrument_id and (x ->> 'accountId')::uuid = p.account_id
        and x ->> 'kind' = p.kind and (x ->> 'due')::date = p.due_date);
  get diagnostics k = row_count;
  return n + k;
end $$;
revoke all on function public.sync_pending_events(jsonb, timestamptz) from public, anon;
grant execute on function public.sync_pending_events(jsonb, timestamptz) to authenticated;
