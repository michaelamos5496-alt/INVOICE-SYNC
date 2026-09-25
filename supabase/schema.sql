-- =============================================================================
-- InvSync — Supabase database setup (multi-shop)
--
-- Run this: Supabase dashboard → SQL Editor → New query → paste → Run.
-- It is safe to run again later (everything is created "if not exists" / replaced), and it
-- UPGRADES a database that was set up with the older single-shop version of this file: all the
-- data already in it is moved into one shop (see section 4) and nothing is deleted.
--
-- How shops work: every person who signs up (with a confirmed email) either
--   • creates their own shop and becomes its Shop Owner (create_my_shop, section 11), or
--   • is already on a shop's staff list — the owner added their email under Employees →
--     "Can sign in" — and so joins that shop.
-- A login belongs to exactly one shop. Every row of business data carries the id of its shop,
-- and row-level security lets a person see and change only the rows of their own shop, so shops
-- can never see each other's products, sales, customers, settings or photos.
--
-- Anyone can create a login, but without a confirmed email and a shop the database shows them
-- nothing and accepts nothing from them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shops and their staff
-- ---------------------------------------------------------------------------
create table if not exists public.shops (
  id                uuid primary key default gen_random_uuid(),
  name              text not null default '',
  created_by        uuid references auth.users (id) on delete set null,
  has_legacy_photos boolean not null default false,   -- the shop that owns product photos uploaded before shops existed (see section 9)
  created_at        timestamptz not null default now()
);
alter table public.shops enable row level security;

-- One row per person allowed into a shop. The email is the primary key, so a login belongs to exactly one shop.
create table if not exists public.staff (
  email      text primary key check (email = lower(email)),
  role       text not null default 'Cashier',
  name       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.staff add column if not exists shop_id uuid references public.shops (id) on delete cascade;
alter table public.staff enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The questions every rule asks: "which shop am I in?" / "am I staff?" / "am I the owner?"
-- ---------------------------------------------------------------------------
create or replace function public.current_shop_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.shop_id
  from auth.users u
  join public.staff s on s.email = lower(u.email)
  where u.id = auth.uid()
    and u.email_confirmed_at is not null   -- verified email, enforced here even if the project setting is off
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.current_shop_id() is not null $$;

-- Matches ROLE_PERMISSIONS in the app: only a shop's Shop Owner manages its employees & settings.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.staff s on s.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and s.shop_id is not null
      and s.role = 'Shop Owner'
  );
$$;

revoke all on function public.current_shop_id() from public, anon;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.current_shop_id() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_owner() to authenticated;

alter table public.staff alter column shop_id set default public.current_shop_id();

-- ---------------------------------------------------------------------------
-- 3. Every table of business data. Each collection is a table of JSON documents:
--    shop_id · id · data (the record) · version (bumped on every change) · created_at · updated_at
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
  everything text[] := array[
    'products', 'categories', 'brands', 'suppliers', 'warehouses', 'customers', 'employees',
    'sales', 'online_orders', 'returns', 'purchase_orders', 'stock_transfers',
    'notifications', 'invoices', 'activity_log', 'inventory_log', 'config'
  ];
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
    execute format('alter table public.%I add column if not exists shop_id uuid', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_row()', t || '_touch', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Connected outside services (Shopify, WooCommerce, Stripe, Paystack, Hubtel), one set per shop — see section 10.
create table if not exists public.integrations (
  provider        text primary key check (provider in ('shopify', 'woocommerce', 'stripe', 'paystack', 'hubtel')),
  status          text not null default 'disconnected' check (status in ('disconnected', 'saved', 'connected', 'error')),
  settings        jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_message    text not null default '',
  connected_by    text not null default '',
  updated_at      timestamptz not null default now()
);
create table if not exists public.integration_secrets (
  provider   text primary key,
  secrets    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.integrations add column if not exists shop_id uuid;
alter table public.integration_secrets add column if not exists shop_id uuid;
alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;   -- and deliberately NO policies: nobody reads it through the API

-- ---------------------------------------------------------------------------
-- 4. Upgrade from the single-shop version: put everything that already exists into ONE shop, then
--    make "which shop?" mandatory on every row. Does nothing on a fresh database, or when run again.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  keycol text;
  legacy uuid;
  needs boolean;
  found_rows boolean;
  scoped text[] := array[
    'products', 'categories', 'brands', 'suppliers', 'warehouses', 'customers', 'employees',
    'sales', 'online_orders', 'returns', 'purchase_orders', 'stock_transfers',
    'notifications', 'invoices', 'activity_log', 'inventory_log', 'config',
    'integrations', 'integration_secrets'
  ];
begin
  -- 4a. Is there anything that doesn't belong to a shop yet?
  needs := exists (select 1 from public.staff where shop_id is null);
  foreach t in array scoped loop
    execute format('select exists (select 1 from public.%I where shop_id is null)', t) into found_rows;
    needs := needs or found_rows;
  end loop;

  -- 4b. If so, they all belong to one "first shop", named after the store name in the old settings.
  if needs then
    select id into legacy from public.shops where has_legacy_photos limit 1;
    if legacy is null then
      insert into public.shops (name, has_legacy_photos)
      values (coalesce(nullif((select data ->> 'storeName' from public.config where id = 'settings' limit 1), ''), 'My Shop'), true)
      returning id into legacy;
    end if;
    update public.staff set shop_id = legacy where shop_id is null;
    foreach t in array scoped loop
      execute format('update public.%I set shop_id = $1 where shop_id is null', t) using legacy;
    end loop;
  end if;

  -- 4c. Every row must name its shop, and new rows get the signed-in person's shop automatically.
  alter table public.staff alter column shop_id set not null;

  -- The secrets table used to point at integrations(provider); it now points at (shop_id, provider).
  alter table public.integration_secrets drop constraint if exists integration_secrets_provider_fkey;

  foreach t in array scoped loop
    keycol := case when t in ('integrations', 'integration_secrets') then 'provider' else 'id' end;
    execute format('alter table public.%I alter column shop_id set default public.current_shop_id()', t);
    execute format('alter table public.%I alter column shop_id set not null', t);
    begin
      execute format('alter table public.%I add constraint %I foreign key (shop_id) references public.shops (id) on delete cascade', t, t || '_shop_fk');
    exception when duplicate_object then null;
    end;
    -- Ids are only unique WITHIN a shop (two shops each have a "settings" row), so the key is (shop_id, id).
    if not exists (
      select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
      where i.indrelid = ('public.' || quote_ident(t))::regclass and i.indisprimary and a.attname = 'shop_id'
    ) then
      execute format('alter table public.%I drop constraint %I', t, t || '_pkey');
      execute format('alter table public.%I add primary key (shop_id, %I)', t, keycol);
    end if;
    if t not in ('integrations', 'integration_secrets') then
      execute format('drop index if exists public.%I', t || '_created_at_idx');
      execute format('create index if not exists %I on public.%I (shop_id, created_at)', t || '_shop_created_idx', t);
    end if;
  end loop;

  begin
    alter table public.integration_secrets add constraint integration_secrets_integration_fk
      foreign key (shop_id, provider) references public.integrations (shop_id, provider) on delete cascade;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Rules for shops and staff
-- ---------------------------------------------------------------------------
-- Safety net: every shop must always keep at least one Shop Owner, or nobody could manage its team or settings again.
create or replace function public.keep_one_owner() returns trigger
language plpgsql as $$
begin
  if old.role = 'Shop Owner'
     and (tg_op = 'DELETE' or new.role is distinct from 'Shop Owner')
     and (select count(*) from public.staff where role = 'Shop Owner' and shop_id = old.shop_id) <= 1 then
    raise exception 'There must always be at least one Shop Owner.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists staff_keep_one_owner on public.staff;
create trigger staff_keep_one_owner before update or delete on public.staff for each row execute function public.keep_one_owner();

drop policy if exists "staff can read staff list" on public.staff;
create policy "staff can read staff list" on public.staff for select to authenticated using (shop_id = public.current_shop_id());
drop policy if exists "owner adds staff" on public.staff;
create policy "owner adds staff" on public.staff for insert to authenticated with check (public.is_owner() and shop_id = public.current_shop_id());
drop policy if exists "owner edits staff" on public.staff;
create policy "owner edits staff" on public.staff for update to authenticated
  using (public.is_owner() and shop_id = public.current_shop_id()) with check (public.is_owner() and shop_id = public.current_shop_id());
drop policy if exists "owner removes staff" on public.staff;
create policy "owner removes staff" on public.staff for delete to authenticated using (public.is_owner() and shop_id = public.current_shop_id());

revoke all on public.staff from anon;
grant select, insert, update, delete on public.staff to authenticated;

-- A shop can be seen by its own people; only its owner can rename it. Shops are created by create_my_shop() below.
drop policy if exists "see own shop" on public.shops;
create policy "see own shop" on public.shops for select to authenticated using (id = public.current_shop_id());
drop policy if exists "owner renames shop" on public.shops;
create policy "owner renames shop" on public.shops for update to authenticated
  using (id = public.current_shop_id() and public.is_owner()) with check (id = public.current_shop_id() and public.is_owner());
revoke all on public.shops from anon, authenticated;
grant select on public.shops to authenticated;
grant update (name) on public.shops to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Rules for the shop's data
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  everyday text[] := array[
    'products', 'categories', 'brands', 'suppliers', 'warehouses', 'customers', 'employees',
    'sales', 'online_orders', 'returns', 'purchase_orders', 'stock_transfers',
    'notifications', 'invoices'
  ];
  trails text[] := array['activity_log', 'inventory_log'];   -- append-only audit trails
begin
  -- everyday collections: any staff member of the shop may read and change that shop's rows (and only those)
  foreach t in array everyday loop
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (shop_id = public.current_shop_id())', t);
    execute format('drop policy if exists "staff insert" on public.%I', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check (shop_id = public.current_shop_id())', t);
    execute format('drop policy if exists "staff update" on public.%I', t);
    execute format('create policy "staff update" on public.%I for update to authenticated using (shop_id = public.current_shop_id()) with check (shop_id = public.current_shop_id())', t);
    execute format('drop policy if exists "staff delete" on public.%I', t);
    execute format('create policy "staff delete" on public.%I for delete to authenticated using (shop_id = public.current_shop_id())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  -- audit trails: entries can be added and read, never edited or erased (no update/delete policy exists)
  foreach t in array trails loop
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (shop_id = public.current_shop_id())', t);
    execute format('drop policy if exists "staff insert" on public.%I', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check (shop_id = public.current_shop_id())', t);
    execute format('grant select, insert on public.%I to authenticated', t);
  end loop;

  -- shop-wide settings (currency, tax, business name…): everyone in the shop reads, only its owner changes
  drop policy if exists "staff read" on public.config;
  create policy "staff read" on public.config for select to authenticated using (shop_id = public.current_shop_id());
  drop policy if exists "owner insert" on public.config;
  create policy "owner insert" on public.config for insert to authenticated with check (public.is_owner() and shop_id = public.current_shop_id());
  drop policy if exists "owner update" on public.config;
  create policy "owner update" on public.config for update to authenticated
    using (public.is_owner() and shop_id = public.current_shop_id()) with check (public.is_owner() and shop_id = public.current_shop_id());
  drop policy if exists "owner delete" on public.config;
  create policy "owner delete" on public.config for delete to authenticated using (public.is_owner() and shop_id = public.current_shop_id());
  grant select, insert, update, delete on public.config to authenticated;
end $$;

-- Stock can never be saved as negative — whichever screen, device or person tries.
alter table public.products drop constraint if exists products_stock_not_negative;
alter table public.products add constraint products_stock_not_negative
  check ((data ->> 'stockQuantity') is null or (data ->> 'stockQuantity')::numeric >= 0);

-- ---------------------------------------------------------------------------
-- 7. Changing part of a record without overwriting the rest
--    merge_doc('products', 'prod_1', '{"name":"New name"}')
--    only touches the fields in the patch, so one person renaming a product can't wipe out a stock
--    change someone else made a moment earlier. Pass expected_version to make it "only if nobody
--    else changed it since I read it" (returns null when they did → the app retries).
--    It runs as the signed-in person, so row-level security keeps it inside their own shop.
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
-- 8. Live updates: tell Supabase Realtime to broadcast changes to these tables
--    (Realtime only sends a person the changes their row-level-security rules let them read.)
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
-- 9. Product photos: a private storage bucket. Each shop's photos live in a folder named after the shop's id,
--    and people can only reach their own shop's folder. Photos uploaded before shops existed sit at the top
--    level of the bucket (they can't be moved); the first shop (has_legacy_photos) keeps access to those.
-- ---------------------------------------------------------------------------
do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('product-images', 'product-images', false)
      on conflict (id) do nothing;

    execute $fn$
      create or replace function public.can_read_photo(object_name text) returns boolean
      language sql stable security definer set search_path = ''
      as $body$
        select public.current_shop_id() is not null and (
          (storage.foldername(object_name))[1] = public.current_shop_id()::text
          or (coalesce(array_length(storage.foldername(object_name), 1), 0) = 0
              and exists (select 1 from public.shops s where s.id = public.current_shop_id() and s.has_legacy_photos))
        )
      $body$
    $fn$;
    revoke all on function public.can_read_photo(text) from public, anon;
    grant execute on function public.can_read_photo(text) to authenticated;

    drop policy if exists "staff read product images" on storage.objects;
    create policy "staff read product images" on storage.objects for select to authenticated
      using (bucket_id = 'product-images' and public.can_read_photo(name));
    drop policy if exists "staff add product images" on storage.objects;
    create policy "staff add product images" on storage.objects for insert to authenticated
      with check (bucket_id = 'product-images' and public.current_shop_id() is not null
                  and (storage.foldername(name))[1] = public.current_shop_id()::text);
    drop policy if exists "staff remove product images" on storage.objects;
    create policy "staff remove product images" on storage.objects for delete to authenticated
      using (bucket_id = 'product-images' and public.can_read_photo(name));
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 10. Integrations (Shopify, WooCommerce, Stripe, Paystack, Hubtel) — one set per shop
--
--    `integrations`        what the shop's team may see: is it connected, and the NON-secret details
--                          (shop address, public key…). Read-only for staff.
--    `integration_secrets` the secret keys. WRITE-ONLY: no policy or grant lets ANY signed-in person
--                          read this table — not staff, not even the owner. The owner saves keys through
--                          save_integration() below; only the server-side "integrations" Edge Function
--                          (which runs with the service key) ever reads them, to talk to the provider.
-- ---------------------------------------------------------------------------
drop policy if exists "staff read integration status" on public.integrations;
create policy "staff read integration status" on public.integrations for select to authenticated using (shop_id = public.current_shop_id());

revoke all on public.integrations from anon, authenticated;
revoke all on public.integration_secrets from anon, authenticated;
grant select on public.integrations to authenticated;

-- Owner-only: save (or update) a provider's details. A secret left out of `p_secrets` keeps its saved value,
-- so "update the shop address" doesn't require typing the key again.
create or replace function public.save_integration(p_provider text, p_settings jsonb, p_secrets jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  sid uuid := public.current_shop_id();
begin
  if not public.is_owner() or sid is null then
    raise exception 'Only the shop owner can connect integrations.' using errcode = '42501';
  end if;
  if p_provider <> all (array['shopify', 'woocommerce', 'stripe', 'paystack', 'hubtel']) then
    raise exception 'Unknown integration %', p_provider using errcode = '22023';
  end if;

  insert into public.integrations (shop_id, provider, status, settings, connected_by, last_message, last_checked_at, updated_at)
  values (sid, p_provider, 'saved', coalesce(p_settings, '{}'::jsonb), coalesce(auth.jwt() ->> 'email', ''), '', null, now())
  on conflict (shop_id, provider) do update
    set status = 'saved', settings = excluded.settings, connected_by = excluded.connected_by,
        last_message = '', last_checked_at = null, updated_at = now();

  insert into public.integration_secrets (shop_id, provider, secrets, updated_at)
  values (sid, p_provider, coalesce(p_secrets, '{}'::jsonb), now())
  on conflict (shop_id, provider) do update
    set secrets = public.integration_secrets.secrets || excluded.secrets, updated_at = now();
end;
$$;

-- Owner-only: forget everything saved for a provider (keys are deleted, not just hidden).
create or replace function public.remove_integration(p_provider text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  sid uuid := public.current_shop_id();
begin
  if not public.is_owner() or sid is null then
    raise exception 'Only the shop owner can disconnect integrations.' using errcode = '42501';
  end if;
  delete from public.integration_secrets where shop_id = sid and provider = p_provider;
  update public.integrations
     set status = 'disconnected', settings = '{}'::jsonb, last_message = '', last_checked_at = null, updated_at = now()
   where shop_id = sid and provider = p_provider;
end;
$$;

revoke all on function public.save_integration(text, jsonb, jsonb) from public, anon;
revoke all on function public.remove_integration(text) from public, anon;
grant execute on function public.save_integration(text, jsonb, jsonb) to authenticated;
grant execute on function public.remove_integration(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Creating a shop. Called by a signed-in person with a confirmed email who isn't in any shop yet:
--     makes the shop, makes them its Shop Owner, and seeds its settings with the shop's name.
-- ---------------------------------------------------------------------------
create or replace function public.create_my_shop(p_shop_name text, p_owner_name text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  addr text;
  clean_name text := left(btrim(coalesce(p_shop_name, '')), 80);
  new_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select lower(email) into addr from auth.users where id = uid and email_confirmed_at is not null;
  if addr is null then
    raise exception 'Confirm your email first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.staff where email = addr) then
    raise exception 'This login already belongs to a shop.' using errcode = 'P0001';
  end if;
  if clean_name = '' then
    raise exception 'Give your shop a name.' using errcode = 'P0001';
  end if;

  insert into public.shops (name, created_by) values (clean_name, uid) returning id into new_id;
  insert into public.staff (email, shop_id, role, name)
    values (addr, new_id, 'Shop Owner', left(btrim(coalesce(p_owner_name, '')), 80));
  insert into public.config (shop_id, id, data)
    values (new_id, 'settings', jsonb_build_object('storeName', clean_name, 'createdAt', now()));
  return new_id;
end;
$$;

revoke all on function public.create_my_shop(text, text) from public, anon;
grant execute on function public.create_my_shop(text, text) to authenticated;

-- =============================================================================
-- That's it. There is no "add yourself as the owner" step any more: sign up in the app with any email,
-- confirm it, and you'll be asked to name your shop — that makes you its Shop Owner.
--
-- Upgrading an existing database: after running this, whoever is already on the staff list (including you)
-- is in the first shop, with all the data that was there before.
-- =============================================================================
