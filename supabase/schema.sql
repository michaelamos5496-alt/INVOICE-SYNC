-- =============================================================================
-- InvSync — Supabase database setup
--
-- Run this ONCE: Supabase dashboard → SQL Editor → New query → paste → Run.
-- It is safe to run again later (everything is created "if not exists" / replaced).
--
-- Who gets in: a person must (1) be signed in, (2) have a CONFIRMED email address, and
-- (3) be on the approved-staff list — a row in the `staff` table with their email. Anyone
-- can create a login, but without (2) and (3) the database shows them nothing and
-- accepts nothing from them. The shop owner manages the staff list from the app's
-- Employees page.
--
-- LAST STEP (at the very bottom): add YOURSELF as the first Shop Owner.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Approved staff + the two questions every rule asks: "is staff?" / "is owner?"
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  email      text primary key check (email = lower(email)),
  role       text not null default 'Cashier',
  name       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.staff s on s.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null   -- verified email, enforced here even if the project setting is off
  );
$$;

-- Matches ROLE_PERMISSIONS in the app: only the Shop Owner manages employees & settings.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.staff s on s.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and s.role = 'Shop Owner'
  );
$$;

revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_owner() to authenticated;

-- Safety net: there must always be at least one Shop Owner, or nobody could manage the team or the settings again.
create or replace function public.keep_one_owner() returns trigger
language plpgsql as $$
begin
  if old.role = 'Shop Owner'
     and (tg_op = 'DELETE' or new.role is distinct from 'Shop Owner')
     and (select count(*) from public.staff where role = 'Shop Owner') <= 1 then
    raise exception 'There must always be at least one Shop Owner.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists staff_keep_one_owner on public.staff;
create trigger staff_keep_one_owner before update or delete on public.staff for each row execute function public.keep_one_owner();

drop policy if exists "staff can read staff list" on public.staff;
create policy "staff can read staff list" on public.staff for select to authenticated using (public.is_staff());
drop policy if exists "owner adds staff" on public.staff;
create policy "owner adds staff" on public.staff for insert to authenticated with check (public.is_owner());
drop policy if exists "owner edits staff" on public.staff;
create policy "owner edits staff" on public.staff for update to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "owner removes staff" on public.staff;
create policy "owner removes staff" on public.staff for delete to authenticated using (public.is_owner());

revoke all on public.staff from anon;
grant select, insert, update, delete on public.staff to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The shop's data. Every collection is a table of JSON documents:
--    id · data (the record) · version (bumped on every change) · created_at · updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin
  new.version    := old.version + 1;   -- lets the app detect "someone else changed this at the same moment"
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
  everyday text[] := array[
    'products', 'categories', 'brands', 'suppliers', 'warehouses', 'customers', 'employees',
    'sales', 'online_orders', 'returns', 'purchase_orders', 'stock_transfers',
    'notifications', 'invoices'
  ];
  trails text[] := array['activity_log', 'inventory_log'];   -- append-only audit trails
  everything text[] := everyday || trails || array['config'];
begin
  foreach t in array everything loop
    execute format($f$
      create table if not exists public.%I (
        id         text primary key,
        data       jsonb not null default '{}'::jsonb,
        version    integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )$f$, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (created_at)', t || '_created_at_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_row()', t || '_touch', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;

  -- everyday collections: any approved staff member may read and change them
  foreach t in array everyday loop
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('drop policy if exists "staff insert" on public.%I', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check (public.is_staff())', t);
    execute format('drop policy if exists "staff update" on public.%I', t);
    execute format('create policy "staff update" on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('drop policy if exists "staff delete" on public.%I', t);
    execute format('create policy "staff delete" on public.%I for delete to authenticated using (public.is_staff())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  -- audit trails: entries can be added and read, never edited or erased (no update/delete policy exists)
  foreach t in array trails loop
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('drop policy if exists "staff insert" on public.%I', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check (public.is_staff())', t);
    execute format('grant select, insert on public.%I to authenticated', t);
  end loop;

  -- store-wide settings (currency, tax, business name…): everyone reads, only the owner changes
  drop policy if exists "staff read" on public.config;
  create policy "staff read" on public.config for select to authenticated using (public.is_staff());
  drop policy if exists "owner insert" on public.config;
  create policy "owner insert" on public.config for insert to authenticated with check (public.is_owner());
  drop policy if exists "owner update" on public.config;
  create policy "owner update" on public.config for update to authenticated using (public.is_owner()) with check (public.is_owner());
  drop policy if exists "owner delete" on public.config;
  create policy "owner delete" on public.config for delete to authenticated using (public.is_owner());
  grant select, insert, update, delete on public.config to authenticated;
end $$;

-- Stock can never be saved as negative — whichever screen, device or person tries.
alter table public.products drop constraint if exists products_stock_not_negative;
alter table public.products add constraint products_stock_not_negative
  check ((data ->> 'stockQuantity') is null or (data ->> 'stockQuantity')::numeric >= 0);

-- ---------------------------------------------------------------------------
-- 3. Changing part of a record without overwriting the rest
--    merge_doc('products', 'prod_1', '{"name":"New name"}')
--    only touches the fields in the patch, so one person renaming a product can't wipe out a stock
--    change someone else made a moment earlier. Pass expected_version to make it "only if nobody
--    else changed it since I read it" (returns null when they did → the app retries).
-- ---------------------------------------------------------------------------
create or replace function public.merge_doc(tbl text, row_id text, patch jsonb, expected_version integer default null)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  result jsonb;
  current_version integer;
begin
  if tbl <> all (array[
    'products', 'categories', 'brands', 'suppliers', 'warehouses', 'customers', 'employees',
    'sales', 'online_orders', 'returns', 'purchase_orders', 'stock_transfers',
    'notifications', 'invoices', 'config'
  ]) then
    raise exception 'merge_doc: table % is not allowed', tbl using errcode = '42501';
  end if;

  execute format(
    'update public.%I t set data = t.data || $1 where t.id = $2 and ($3::integer is null or t.version = $3::integer)
     returning jsonb_build_object(''id'', t.id, ''data'', t.data, ''version'', t.version)', tbl)
    using patch, row_id, expected_version into result;

  if result is null then
    -- Nothing changed. Work out why, so the app never mistakes "refused" for "saved".
    execute format('select t.version from public.%I t where t.id = $1', tbl) using row_id into current_version;
    if current_version is null then
      raise exception 'not_found' using errcode = 'P0002';
    elsif expected_version is null or current_version = expected_version then
      -- the row is there and unchanged, yet the update matched nothing: row-level security refused it
      raise exception 'permission denied for %', tbl using errcode = '42501';
    end if;
    -- otherwise somebody else changed it since expected_version: return null so the app re-reads and retries
  end if;
  return result;
end;
$$;

revoke all on function public.merge_doc(text, text, jsonb, integer) from public, anon;
grant execute on function public.merge_doc(text, text, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Live updates: tell Supabase Realtime to broadcast changes to these tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'products', 'categories', 'brands', 'suppliers', 'warehouses', 'customers', 'employees',
      'sales', 'online_orders', 'returns', 'purchase_orders', 'stock_transfers',
      'notifications', 'invoices', 'activity_log', 'inventory_log', 'config'
    ] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Product photos: a private storage bucket only approved staff can use
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('product-images', 'product-images', false)
      on conflict (id) do nothing;

    drop policy if exists "staff read product images" on storage.objects;
    create policy "staff read product images" on storage.objects for select to authenticated
      using (bucket_id = 'product-images' and public.is_staff());
    drop policy if exists "staff add product images" on storage.objects;
    create policy "staff add product images" on storage.objects for insert to authenticated
      with check (bucket_id = 'product-images' and public.is_staff());
    drop policy if exists "staff remove product images" on storage.objects;
    create policy "staff remove product images" on storage.objects for delete to authenticated
      using (bucket_id = 'product-images' and public.is_staff());
  end if;
end $$;

-- =============================================================================
-- LAST STEP — add yourself as the first Shop Owner.
-- Replace the email (lowercase!) and name, then run just this statement.
-- Then sign up in the app with that same email and confirm it from the email Supabase sends.
-- =============================================================================
-- insert into public.staff (email, role, name) values ('you@example.com', 'Shop Owner', 'Your Name')
--   on conflict (email) do update set role = 'Shop Owner';
