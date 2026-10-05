-- Security foundation (plan §1.1–§1.4).
--
-- Order matters: the audit trigger on private.app_members is installed in this
-- same migration, before any member row can exist, so the very first (bootstrap)
-- insert is logged exactly like every later change.

------------------------------------------------------------------------------
-- 1. private schema: not exposed through the Data API.
--    authenticated may only *call* the two boolean helpers used by RLS
--    policies; no role except postgres has any privilege on its tables.
------------------------------------------------------------------------------
create schema private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

------------------------------------------------------------------------------
-- 2. Audit log
------------------------------------------------------------------------------
create table private.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- auth.uid() for app users; otherwise the database role (e.g. postgres from
  -- the SQL editor, service_role from a script).
  actor text not null,
  action text not null,
  table_name text not null,
  row_key text,
  old_row jsonb,
  new_row jsonb
);

create function private.current_actor() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    auth.uid()::text,
    nullif(current_setting('role', true), 'none'),
    session_user::text
  )
$$;

create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into private.audit_log (actor, action, table_name, row_key, old_row, new_row)
  values (
    private.current_actor(),
    tg_op,
    tg_table_schema || '.' || tg_table_name,
    coalesce(r ->> 'id', r ->> 'user_id'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

------------------------------------------------------------------------------
-- 3. Owner membership: at most one owner, audited from the first row on.
------------------------------------------------------------------------------
create table private.app_members (
  user_id uuid primary key references auth.users (id) on delete restrict,
  role text not null default 'owner' check (role = 'owner'),
  granted_via text not null check (granted_via in ('bootstrap', 'recovery')),
  approved_factor_ids uuid[] not null default '{}',
  granted_at timestamptz not null default now()
);
create unique index app_members_single_owner on private.app_members (role) where role = 'owner';

-- 4. Trigger in place before any row exists.
create trigger app_members_audit
  after insert or update or delete on private.app_members
  for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- 5. Boolean helpers for RLS (security definer, fixed search_path).
------------------------------------------------------------------------------
create function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_members m where m.user_id = auth.uid())
$$;

-- A session is trusted when all three hold (plan §1.1):
--   * it is aal2,
--   * it was elevated with a factor the owner approved (auth.sessions.factor_id),
--   * the latest TOTP verification is at most 12 hours old (amr timestamp).
create function private.has_trusted_aal2() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1
      from auth.sessions s
      join private.app_members m on m.user_id = s.user_id
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid()
        and s.aal = 'aal2'
        and s.factor_id = any (m.approved_factor_ids)
    )
    and exists (
      select 1
      from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
      where a ->> 'method' = 'totp'
        and to_timestamp((a ->> 'timestamp')::bigint) > now() - interval '12 hours'
    ),
    false
  )
$$;

create function private.trusted_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner() and private.has_trusted_aal2()
$$;

-- Lock everything in private down, then open exactly the three helpers.
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all sequences in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.is_owner(), private.has_trusted_aal2(), private.trusted_owner() to authenticated;

------------------------------------------------------------------------------
-- 6. Shared building blocks for personal tables (plan §1.4).
------------------------------------------------------------------------------
create function private.forbid_owner_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

-- Applies the standard policy set to a personal table. Migration-only helper.
create function private.secure_personal_table(tbl regclass, append_only boolean)
returns void language plpgsql set search_path = '' as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('revoke all on %s from anon', tbl);
  execute format('revoke truncate, references, trigger on %s from authenticated', tbl);

  -- Restrictive: every command requires the trusted owner.
  execute format(
    'create policy trusted_owner_only on %s as restrictive for all to authenticated
       using ((select private.trusted_owner())) with check ((select private.trusted_owner()))', tbl);

  -- Permissive: own rows only.
  execute format('create policy own_rows_select on %s for select to authenticated
                    using (owner_id = (select auth.uid()))', tbl);
  execute format('create policy own_rows_insert on %s for insert to authenticated
                    with check (owner_id = (select auth.uid()))', tbl);

  if append_only then
    execute format('revoke update, delete on %s from authenticated', tbl);
  else
    execute format('create policy own_rows_update on %s for update to authenticated
                      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', tbl);
    execute format('create policy own_rows_delete on %s for delete to authenticated
                      using (owner_id = (select auth.uid()))', tbl);
    execute format('create trigger forbid_owner_change before update on %s
                      for each row execute function private.forbid_owner_change()', tbl);
  end if;
end $$;
revoke all on function private.secure_personal_table(regclass, boolean), private.forbid_owner_change()
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- 7. First personal tables. The remaining ones follow in phase 2 with the
--    same helper. Composite foreign keys keep references within one owner.
------------------------------------------------------------------------------
create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
select private.secure_personal_table('public.institutions', false);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  institution_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 100),
  account_type text not null default 'normal' check (account_type in ('normal', 'tbsz', 'nyesz')),
  -- Tracking start (plan §2): opening balances describe the END of this day.
  tracking_start_date date not null,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (institution_id, owner_id) references public.institutions (id, owner_id)
);
select private.secure_personal_table('public.accounts', false);

------------------------------------------------------------------------------
-- 8. FX rates: not personal, but the same trusted-owner gate; append-only.
--    Meaning, always: 1 unit of base = rate units of quote (plan §3.1).
------------------------------------------------------------------------------
create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  base char(3) not null check (base ~ '^[A-Z]{3}$'),
  quote char(3) not null check (quote ~ '^[A-Z]{3}$'),
  rate numeric(24, 12) not null check (rate > 0),
  rate_date date not null,
  source text not null check (source in ('MNB', 'ECB', 'manual', 'broker')),
  raw_unit integer not null default 1 check (raw_unit > 0),
  status text not null default 'ok' check (status in ('ok', 'suspect')),
  supersedes_id uuid references public.fx_rates (id),
  note text,
  fetched_at timestamptz not null default now(),
  check (base <> quote),
  check (source <> 'manual' or note is not null)
);
create unique index fx_rates_one_per_source_day
  on public.fx_rates (base, quote, rate_date, source)
  where source in ('MNB', 'ECB');

alter table public.fx_rates enable row level security;
revoke all on public.fx_rates from anon;
revoke update, delete, truncate, references, trigger on public.fx_rates from authenticated;
create policy trusted_owner_only on public.fx_rates as restrictive for all to authenticated
  using ((select private.trusted_owner())) with check ((select private.trusted_owner()));
create policy trusted_owner_read on public.fx_rates for select to authenticated using (true);
create policy trusted_owner_append on public.fx_rates for insert to authenticated with check (true);

------------------------------------------------------------------------------
-- 9. What the app may ask about the *current* session (used by the proxy to
--    route between /login, /mfa and the app). Booleans about the caller only.
------------------------------------------------------------------------------
create function public.session_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_owner', private.is_owner(),
    'aal2', coalesce(auth.jwt() ->> 'aal', '') = 'aal2',
    'trusted', private.has_trusted_aal2()
  )
$$;
revoke all on function public.session_status() from public, anon;
grant execute on function public.session_status() to authenticated;
