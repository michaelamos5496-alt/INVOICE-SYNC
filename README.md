# InvSync — Unified Inventory Management System

A single source of truth for a retail business selling through a physical
shop and an online store simultaneously. Stock changes on either channel
write to the same product record, so both channels always show the same
quantity.

## Phase 1 status: Project Architecture — complete
## Phase 2 status: UI Design System — complete
## Phase 3 status: Dashboard — complete
## Phase 4 status: Products (Catalog) — complete
## Phase 5 status: Inventory — complete
## Phase 6 status: POS — complete
## Phase 7 status: Online Orders — complete
## Phase 8 status: Reports — complete
## Phase 9 status: Settings — complete

Phase 1 established navigation, layout, theming, and the data-access
layer. Phase 2 built the reusable component library every later phase
composes with instead of hand-rolling markup — see it live at
`pages/design-system.html`.

Phase 3 replaced the Dashboard placeholder with a fully live page:
8 KPI stat cards (Total Products, Low Stock, Out of Stock, Inventory
Value, Today's/Weekly/Monthly Sales, Today's Orders), a Sales Trend
line chart and Stock Movement bar chart (Chart.js, theme-aware — see
`assets/js/utils/chart-theme.js`), Top Selling Products, Recent
Activity, a Notifications preview, and a paginated Latest Transactions
table. All of it is real data flowing through `analytics.service.js`
(a new read-only aggregation layer over `api.service.js`) — nothing on
the dashboard is hardcoded markup. Phase 3 also includes the full
**Notifications** center (`pages/notifications.html`) — filterable by
all 7 categories from the spec (Low Stock, Out of Stock, New Orders,
Payment Received, Returns, Failed Payments, System Alerts), with
mark-as-read/mark-all-read/dismiss, live-updating the topbar bell badge
— and the full **Activity Logs** page (`pages/activity-logs.html`), a
searchable/sortable audit trail. Both were initially left as dashboard
previews only; they're now complete pages in their own right.

Phase 4 built the full Catalog: **Products** (`pages/products.html`) is
the first page with real create/edit/delete, backed by
`products.service.js`. It supports every field from the spec — SKU,
barcode (with a generator), category/brand/supplier linkage,
cost/selling price, discount, color/size/weight, location, batch
number, expiration date, variants (color/size/stock/price-adjustment
rows), and photos — via a tabbed add/edit modal. On the **Images** tab you
can take a picture or pick from the gallery (phones), or drag and drop
(desktop): up to 6 photos per product, the first being the "main" one shown
in the catalog and POS, with tap-to-reorder. Photos are resized in the
browser (max 1200px, WebP) before storing — a 6 MB phone shot becomes
~100 KB — and kept in IndexedDB (`services/image-store.service.js`) rather
than `localStorage`, whose ~5 MB cap a shop's worth of photos would exhaust
after roughly 100 products. Product records only hold a short `idb:<id>`
reference. Photos are written on Save (cancelling leaves nothing behind),
freed when removed or the product is deleted, copied on Duplicate, and
wiped by Settings → Data → Clear. If IndexedDB is unavailable the photo is
kept inline in the product instead, and pasting an image URL still works.
They live in the browser for now; Phase 10 swaps in cloud object storage
behind the same module.
Critically, **stock quantity is never written directly**: creating a
product routes its starting quantity through `adjustStock()`, and
editing one routes quantity changes through `applyStockCount()` — both
from `inventory.service.js` — so even a catalog edit produces the same
audit trail and low/out-of-stock notifications a POS sale would.
**Categories, Brands, and Suppliers** are also fully functional CRUD
pages, all built from one config-driven controller
(`simple-catalog.page.js`) since they're structurally identical flat
lists. Product create/edit/delete now also append to the activity log,
so Activity Logs and the dashboard's Recent Activity feed grow from
real usage, not just seed data.

Phase 5 built out Inventory operations. **Inventory** (`pages/inventory.html`)
is the operational hub: Add Stock / Remove Stock / Stock Count actions
per product (all through `inventory.service.js`'s `adjustStock` /
`applyStockCount`), a per-product movement history modal
(`getProductHistory`), category/status filters, a barcode/SKU "scan"
input (a plain text field + Enter — the same input method real HID
barcode scanners use, so it works with actual scanner hardware without
needing camera APIs), and Bulk Import/Export as CSV (`utils/helpers.js`
gained a small `parseCSV`, pairing with the existing `exportToCSV`).
**Purchase Orders** (`pages/purchase-orders.html`,
`purchase-orders.service.js`) support multi-line-item orders against a
supplier; creating one never touches stock, only **Receive** does,
restocking every line item through the same shared inventory choke
point. **Stock Transfers** (`pages/stock-transfers.html`) move a
product between locations — net quantity change is zero, but the
product's `location` field updates and both legs of the move are
logged. **Warehouse** (`pages/warehouse.html`) is a CRUD page for
locations, reusing the same `simple-catalog.page.js` factory as
Categories/Brands/Suppliers (now with a `select` field type).

Phase 6 built the in-store checkout. **POS** (`pages/pos.html`,
`pos.service.js`) is a product-grid + cart layout: search, a
barcode/SKU scan input (same HID-scanner-friendly pattern as
Inventory), category quick-filters, out-of-stock items shown disabled,
a live cart with quantity steppers capped at on-hand stock,
discount %/tax % fields, customer selection, and order notes. Checkout
opens a payment modal with Cash (tendered amount + change due), Card,
Mobile Money, and Split (two amounts that must sum to the total) —
confirming validates stock one more time, deducts every line item
through `deductForSale()` (the same shared choke point POS and Online
Orders both use), persists the sale, updates the customer's order
history, logs the activity, and opens a printable itemized receipt
(`window.print()` with a `@media print` rule that hides everything but
the receipt). Every step was verified against real localStorage state,
not just screenshots.

Phase 7 completed the Sales nav group. **Online Orders**
(`pages/online-orders.html`, `online-orders.service.js`) is the payoff
of the whole "one shared inventory" premise: an order here deducts
stock through the identical `deductForSale()` call the POS uses, just
tagged `CHANNELS.ONLINE`. Since there's no live storefront to webhook
from yet (that's Phase 10), a **Simulate Incoming Order** button fires
the exact same code path a real Shopify/WooCommerce webhook handler
would; there's also a manual order-builder for testing specific
products. Orders can be marked Fulfilled or Cancelled — cancelling
restocks every line item. **Sales** (`pages/sales.html`) is the
read-only in-store history POS checkouts write to. **Returns**
(`pages/returns.html`, `returns.service.js`) processes a return against
a specific item from a past sale or online order, restocking through
the same `restockFromReturn()` choke point. **Customers**
(`pages/customers.html`) is a unified directory — `totalOrders` /
`totalSpent` are read-only, maintained automatically by the POS and
Online Orders services, with a combined order-history view spanning
both channels.

**Bug caught and fixed during testing**: seeded historical sales/online
orders were missing the `name` field on their line items (real
checkouts from POS/Online Orders always include it), so returns against
seed data showed "undefined" as the product name and sale detail
modals showed a ₵0.00 subtotal despite a real total. Fixed in
`seed.service.js` and verified via both a rendered screenshot and a
direct localStorage check.

Phase 8 built the Insights group. **Reports** (`pages/reports.html`,
`reports.service.js`) is seven tabs in one page — Sales, Inventory,
Profit, Customers, Employees, Purchases, Suppliers — each with its own
Chart.js chart and DataTable, covering every report type from the
spec (Revenue Dashboard folded into the Sales tab, since Phase 3's
Dashboard already covers that ground). Profit is computed per order
item as `(sellingPrice − currentCostPrice) × quantity`, a simplification
against tracking historical cost-at-time-of-sale that's reasonable at
this system's scale. **Analytics** (`pages/analytics.html`) holds the
three trend-analysis views that don't fit a point-in-time report:
Product Performance, Fast Moving Products (last 14 days), and Dead
Stock (in stock but unsold in 30 days, sorted by capital tied up).
Chart.js instances are tracked per canvas id and `.destroy()`'d before
each re-render, since re-initializing a canvas Chart.js already owns
throws — this matters here because tab-switching re-renders the active
panel's chart every time.

**One more seed-data bug caught and fixed while testing this phase**
(same root cause as Phase 7's: hand-written seed records drifting from
what real writes produce): seeded sales were missing the `cashier`
field, so the Employee report showed "Unknown" instead of "Efua Asante" —
fixed in `seed.service.js` alongside the earlier `name`/`subtotal`
fixes. Every report tab was verified with a real headless browser and
zero console errors, including tab-to-tab chart switching.

Phase 9 built out the Organization group. **Employees**
(`pages/employees.html`) is staff CRUD with a role field (Shop Owner,
Manager, Cashier, Inventory Staff) — picking a role shows a live
"this role can:" permissions preview from `ROLE_PERMISSIONS` in
`constants.js`. These permissions are display-only in this phase: there's
no auth system yet to actually enforce them, since login/sessions are
part of Phase 10's backend work. **Settings** (`pages/settings.html`,
`settings.service.js`) covers Store Profile, Tax & Currency,
Integrations, and Preferences as four tabs, each saving independently.
Two things actually reach into the rest of the app rather than sitting
inert: the dark-mode toggle in Preferences drives the same
`localStorage` key the topbar toggle uses, and the Tax & Currency
tab's default tax rate now pre-fills the POS screen's tax field on
load (verified end-to-end: set 12.5% in Settings, confirmed the POS
page opened with 12.5 already in its tax input). The currency you pick
there is the single source of truth for money everywhere: `formatCurrency()`
in `utils/formatters.js` defaults to `getCurrency()` from
`settings.service.js` (cached, cleared when settings change — including from
another tab), so every price, total, chart axis and new log/notification
message follows it. It's a display setting: amounts are relabelled, not
converted. Invoices record their currency when created and keep it. Integrations
(Shopify, WooCommerce, Stripe, Paystack, Hubtel) are static
"Not Connected" cards with disabled Connect buttons — real OAuth/API-key
flows are Phase 10 work; this phase just gives them a home. Remaining
module pages are still scaffolded placeholders.

**Invoices** (`pages/invoices.html`, `invoices.service.js`) is the
invoice generator. An invoice can be built from scratch (catalog
products or free-text custom lines, discount %, tax % pre-filled from
Settings, Net 7/14/30 due-date presets) or generated from any POS sale
or online order — via the page's **From Order** picker or the new
**Create Invoice** button in the Sales / Online Orders detail modals
(`?fromSale=` / `?fromOnline=` deep links). Invoices are numbered
sequentially (`INV-0001`…), move draft → sent → paid (or void), and
"overdue" is derived from a sent invoice past its due date rather than
stored. The bill-to details are snapshotted onto the invoice, so later
customer edits never rewrite an issued invoice. The invoice renders as
a white, print-ready document in the store's configured currency;
**Print / PDF** prints only that document (Save as PDF defaults the
filename to the invoice number), and **Email** opens a prefilled
`mailto:`. Invoices are billing documents only — they never move stock,
since invoiced orders were already deducted at checkout.

## Production readiness

A hardening pass over the whole frontend, separate from the phase
build-out above. Scope: everything that's realistic to fix without a
backend (that's still Phase 10); this pass is about the app not being
a security or accessibility liability as a static frontend.

- **XSS.** Every page was building tables/modals via
  `container.innerHTML = \`...${userInput}...\`` — if someone typed
  `<img src=x onerror=...>` into a product name, note, or reason field,
  it would execute when rendered back. Added `escapeHTML()` and
  `isSafeImageUrl()` to `assets/js/utils/helpers.js` and swept every
  page controller to wrap user-typed values before they hit innerHTML
  (table cells, modal bodies, `value="..."` attributes, textarea
  content, image `src`). `toast.js` was also rebuilt to set message
  text via `textContent` instead of an innerHTML template, so a toast
  is safe by construction even if a future call site forgets to escape.
- **Compiled Tailwind.** The Play CDN (`cdn.tailwindcss.com`) logs a
  "should not be used in production" warning and recompiles utilities
  with an in-browser JIT on every page load. Replaced with a real
  build: `tailwind.config.js` + `npm run build:css` produces a static,
  minified `assets/css/tailwind.css` checked into the repo — verified
  pixel-identical to the CDN version in both light and dark mode, zero
  console warnings.
- **Accessibility.** `modal.js` now traps Tab/Shift+Tab focus inside
  the open dialog, moves focus in on open, and restores it to whatever
  triggered the modal on close. `dropdown.js` got the standard
  `aria-haspopup`/`aria-expanded`/`role="menu"` wiring plus
  Arrow/Home/End keyboard navigation. A "Skip to main content" link
  (`.skip-link` in `main.css`) was added to every page so keyboard
  users don't have to tab through the full sidebar to reach content.
  Chart y-axes got `beginAtZero: true` so an all-zero dataset (a brand
  new store) doesn't render a nonsensical negative range.
- **SEO/PWA basics.** Every page has a unique `<meta name="description">`,
  a favicon (`assets/img/favicon.svg`, matching the sidebar brand
  mark), `theme-color`, and `apple-touch-icon`. Added `404.html` and
  `robots.txt` at the project root.
- **Data lifecycle.** The app used to auto-seed demo data into
  localStorage on every first load — fine for development, wrong for a
  real launch (a shop owner's first screen showing fake products isn't
  "production ready"). `app.js` no longer calls the seeder.
  `reset.service.js` now backs two explicit actions in **Settings →
  Data**: *Load Sample Data* (opt-in, never overwrites real records —
  `storage.seedIfEmpty` is a no-op per key once data exists) and
  *Clear All Data* (wipes every product/order/customer/log entry, but
  deliberately leaves the store profile and theme/tax preferences
  alone — verified with a real save-then-clear cycle that Settings
  survives a full data wipe). Disabling the seeder doesn't retroactively
  clean up browsers that already have the old auto-seeded demo data
  sitting in localStorage from before this change, so `app.js` also
  runs a one-time migration (`migrateLegacyAutoSeed()`) on boot: if it
  finds the old seed's deterministic ids (e.g. `prod_seed_1`), it clears
  business data automatically and tells the user via a toast, then sets
  a flag so it never touches real data on any later load — verified by
  simulating a pre-existing legacy install, confirming the auto-clear
  fires exactly once, and confirming a real product added afterward
  survives a reload untouched.

All of the above was verified with a real headless-browser pass, not
just code review: all 21 pages load with zero console errors, the skip
link is the first Tab stop and jumps focus correctly, a modal traps
focus and returns it to the trigger on Escape, and dropdown Arrow-key
navigation moves focus between items.

**What's intentionally not in this pass:** exhaustive `<label for>` /
input `id` linkage across every form (most labels are visually
adjacent to their input but not programmatically associated — a real
gap for screen reader users, flagged here rather than silently
skipped, since a safe bulk fix wasn't feasible without touching dozens
of forms by hand); rate limiting, CSRF, and server-side input
validation (meaningless without a backend — Phase 10); and automated
test coverage (no test runner is part of the current stack).

## Tech stack

HTML5 · Tailwind CSS (compiled build, see "Running it") · Vanilla JavaScript ES6 modules ·
Chart.js (added in Phase 8) · Font Awesome · Google Fonts (Inter + Plus
Jakarta Sans).

The data layer is written so it can be repointed at a real backend
(Node/Express, Supabase/Firebase, MySQL/PostgreSQL, Stripe/Paystack/Hubtel)
in Phase 10 without touching any page code — see **Data architecture**
below.

## Running it

Because pages use `fetch()` to load shared HTML partials and native ES
modules, the project must be served over HTTP — opening the HTML files
directly (`file://`) will fail due to browser CORS restrictions on
`fetch`/modules.

```bash
npm install        # once — installs the Tailwind CLI (dev-only dependency)
npm run build:css  # compiles assets/css/tailwind.css from tailwind.config.js
npm run serve       # python3 -m http.server 8080
```

Then open `http://localhost:8080/`. If you edit any Tailwind class names
in the HTML/JS, re-run `npm run build:css` (or `npm run watch:css` while
developing) — the compiled stylesheet is checked in, so the app runs
without a build step for anyone who isn't actively changing markup.

**First launch is empty on purpose.** The app no longer auto-seeds demo
data (see "Data lifecycle" below) — go to **Settings → Data → Load
Sample Data** to populate it for exploring, or start entering real
products immediately.

## Folder structure

```
├── index.html                  Redirects to pages/dashboard.html
├── 404.html                    Static not-found page
├── robots.txt
├── tailwind.config.js           Compiled-build config (see "Running it")
├── package.json                 devDependency: tailwindcss CLI; build:css/watch:css/serve scripts
├── pages/                      One HTML file per module (see Core Modules)
├── components/                 Shared HTML partials (sidebar, topbar)
├── assets/
│   ├── css/
│   │   ├── tokens.css          Design tokens: color, spacing, shadow, motion (CSS vars)
│   │   ├── main.css            Hand-written utilities (glass, cards, skeletons, toasts, skip-link)
│   │   ├── components.css      Component library: buttons, badges, alerts, forms, tabs, dropdowns, tables, pagination, stat cards, empty states
│   │   ├── tailwind-source.css  @tailwind directives — input to the build
│   │   └── tailwind.css         Compiled output, checked in (do not hand-edit)
│   ├── js/
│   │   ├── app.js              Per-page bootstrap: injects partials, wires nav/theme/search
│   │   ├── config/
│   │   │   ├── constants.js    Storage keys, enums (channels, statuses, order/payment types, roles)
│   │   │   └── nav.config.js   Single source of truth for sidebar navigation
│   │   ├── services/
│   │   │   ├── storage.service.js    Only module that touches localStorage directly
│   │   │   ├── api.service.js        CRUD facade; swaps local <-> REST via one flag
│   │   │   ├── inventory.service.js  THE stock-adjustment choke point (see below)
│   │   │   ├── analytics.service.js  Read-only aggregation for Dashboard/Reports (KPIs, trends, top products)
│   │   │   ├── products.service.js   Product CRUD; routes all stock quantity changes through inventory.service.js
│   │   │   ├── purchase-orders.service.js  PO lifecycle; only receivePurchaseOrder touches stock
│   │   │   ├── pos.service.js        Cart totals math + checkout(), which deducts stock via inventory.service.js
│   │   │   ├── online-orders.service.js  Deducts stock via the same choke point, tagged CHANNELS.ONLINE
│   │   │   ├── returns.service.js    Restocks via inventory.service.js's restockFromReturn()
│   │   │   ├── reports.service.js    Sales/Inventory/Profit/Customer/Employee/Purchase/Supplier aggregations
│   │   │   ├── settings.service.js   Single-record store settings (profile, tax/currency, preferences)
│   │   │   ├── reset.service.js      Settings → Data: Load Sample Data / Clear All Data
│   │   │   └── seed.service.js       Sample data generator, opt-in only (see reset.service.js)
│   │   ├── components/         sidebar.js, topbar.js, toast.js, modal.js (focus trap), tabs.js, dropdown.js (keyboard nav), table.js (DataTable), stat-card.js, empty-state.js, skeleton.js
│   │   ├── pages/               products.page.js, simple-catalog.page.js (Categories/Brands/Suppliers/Warehouse), notifications.page.js, activity-log.page.js, inventory.page.js, purchase-orders.page.js, stock-transfers.page.js, pos.page.js, sales.page.js, online-orders.page.js, returns.page.js, customers.page.js, reports.page.js, analytics.page.js, employees.page.js, settings.page.js
│   │   └── utils/               formatters.js, helpers.js (escapeHTML, isSafeImageUrl), chart-theme.js — pure, page-agnostic helpers
│   ├── data/                   Reserved for static seed/export files
│   └── img/                     favicon.svg + other static images
└── README.md
```

## How "one shared inventory" is enforced

`assets/js/services/inventory.service.js` is the only place any code is
allowed to change a product's `stockQuantity`. A POS sale
(`pages/pos.html`, Phase 6) and an online order webhook
(`pages/online-orders.html`, Phase 7) both call the same
`deductForSale()` function, which reads and writes through
`api.service.js` → `storage.service.js` → the same `products` record.
There is structurally no path for the two channels to see divergent
stock, because they are not two datasets kept in sync — they are one
dataset with two entry points. Every adjustment also appends an
immutable row to the inventory log, which powers the inventory timeline
and audit trail in later phases.

## Data architecture (today vs. Phase 10)

`assets/js/config/constants.js` exports `DATA_ADAPTER`, currently `'local'`.
`api.service.js` defines both a `local` adapter (backed by
`storage.service.js` / `localStorage`) and a `rest` adapter (backed by
`fetch` against `API_BASE_URL`) behind the identical method signatures
(`list`, `get`, `create`, `update`, `remove`, `subscribe`). Flipping
`DATA_ADAPTER` to `'rest'` in Phase 10 repoints every page at a real
Node/Express + PostgreSQL/MySQL API (or Supabase) with no changes to
page-level code. Payment provider integration (Stripe/Paystack/Hubtel)
and online-store sync (Shopify/WooCommerce) plug into
`pages/pos.html`'s payment step and `pages/online-orders.html`'s
webhook handler respectively, both of which already funnel stock
changes through `inventory.service.js`.

## Design system

- Color, spacing, radius, shadow and motion are defined once as CSS
  custom properties in `assets/css/tokens.css`, and mirrored into the
  Tailwind CDN theme in `assets/js/config/tailwind.init.js`, so utility
  classes and hand-written CSS never drift out of sync.
- Dark mode uses Tailwind's `class` strategy on `<html>`, persisted to
  `localStorage` and applied before first paint (inline script in every
  page `<head>`) to avoid a flash of the wrong theme.
- Shared chrome (sidebar, topbar) lives in `components/*.html` and is
  injected at runtime by `app.js`, so branding/layout changes are made
  once, not across 20+ page files.

## Live sync & sign-in (Supabase)

> **Sharing is currently OFF.** `CLOUD_SYNC` in `assets/js/config/supabase.config.js`
> is `false`, so the app works in this browser only, with no login, exactly as
> before, and Supabase is never contacted. Everything below describes what
> happens once you switch it on (after the one-time setup).

With `CLOUD_SYNC = true`, **all business data lives in your Supabase database and is shared live**:
when anyone adds a product, rings up a sale, receives stock, changes a price or sends an invoice,
every other open screen — dashboard, inventory, POS, reports… — updates by itself, with no reload.
Photos are shared too (Supabase Storage). People sign in, and the database itself decides who gets
in.

### How it works

* **One data layer, two back ends.** Pages and services call `api.products.list()` etc.
  (`services/api.service.js`). With sync off that's localStorage; with sync on the very same
  calls go to `services/cloud-data.service.js`, which keeps a live in-memory copy of each
  collection (loaded once, then kept current by Supabase Realtime) and writes through to Postgres.
  Each collection is one table of JSON documents (`id, data, version, created_at`) — see
  `supabase/schema.sql`.
* **Pages refresh themselves.** Each page calls `watchData([...collections], refresh)`
  (`services/live-data.js`). Refreshes caused by someone else's change are quiet: no loading
  flash and no jumping back to page 1 while you browse (`utils/live-flag.js`).
* **Stock is safe with many people at once.** Every stock change is "read, compute, write only
  if nobody changed it meanwhile, retry otherwise" (`mutate()` → the `merge_doc` function in
  `schema.sql`). Six checkouts racing for the last three units produce exactly three sales;
  a checkout that fails halfway puts back what it already took (`pos.service.js`,
  `online-orders.service.js`). The database also refuses negative stock outright.
  Editing a record only changes the fields you touched, so renaming a product can't wipe out a
  stock change someone else just made.
* **Many shops, one app.** Every person who signs up gets their own shop: after confirming their
  email they name it and become its Shop Owner (`create_my_shop()` in `schema.sql`). Every row of
  business data — products, sales, customers, settings, integrations, photos — carries the id of
  its shop, and the database's row-level-security rules only ever show a person their own shop's
  rows, so shops can't see each other. A login belongs to exactly one shop.
* **Who gets in — three things, enforced by the database, not just the screens:**
  1. a login (Supabase Auth), 2. a **confirmed** email address, 3. a shop: the email is on a
  shop's staff list (`staff` table) — either because they created the shop or because that shop's
  owner added them under **Employees → Can sign in** (an invited person who signs up with that email
  lands in the owner's shop instead of creating their own). Anyone can create a login, but without
  a confirmed email and a shop they see nothing and can change nothing. Only a shop's Shop Owner can
  change its staff list or its settings; log entries (activity, stock movements) can be added but
  never edited or deleted; and the database refuses to remove a shop's last Shop Owner.
* **Sign-in flow.** `bootstrapApp()` calls `requireSession()` (`services/auth.service.js`) first:
  people who aren't fully in are sent to `pages/login.html` — which handles sign in, create
  account (with a shop name), "confirm your email", "name your shop", forgot password and choosing a new
  password — and land back on the page they asked for (`next` is validated, so it can't be used
  as an open redirect). Being offline is not the same as being signed out: a signed-in person
  whose connection drops gets a "can't reach your data" screen with **Try again**, not the login
  page.
* **Everything typed by a person is escaped before it goes on a screen** (product names, customer
  names, notes, actor names…). That matters more once data is shared, so one person's text can't
  run as code on another person's screen — covered by a test that plants hostile text in every
  kind of record and loads every page.
* **What's cached where.** Photos downloaded from the shared bucket are cached in the browser
  and cleared at sign-out. The shop name from Settings is mirrored into localStorage so the login
  and splash screens can show it before anyone has signed in.

### One-time setup

1. Create a project at [supabase.com](https://supabase.com) (the free plan needs no card).
2. **SQL Editor → New query:** paste all of `supabase/schema.sql` and run it. It creates the tables,
   the security rules, live-update publication and the private photo bucket, and is safe to re-run.
   **Upgrading a database from the single-shop version?** Take a backup first (Database → Backups),
   then run the same file: everything already in the database is moved into one shop (named after your
   store name), your existing staff become that shop's staff, and nothing is deleted. Old product
   photos stay where they are and remain visible to that first shop.
3. There is no "add yourself as owner" step any more: sign up in the app (step 7) and name your shop —
   that makes you its Shop Owner.
4. **Project Settings → API:** copy the *Project URL* and the *anon public* key into
   `assets/js/config/supabase.config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). The anon key is meant
   to be public and is safe to commit. **Never** put the `service_role` key anywhere in this repo.
5. **Authentication → URL Configuration:** set *Site URL* to your deployed address and add
   `https://YOUR-DOMAIN/pages/login.html` (and `http://localhost:8080/pages/login.html` for local
   development) to *Redirect URLs*. Without this, confirmation and password-reset emails link to the
   wrong place.
6. **Authentication → Sign In / Providers → Email:** keep *Confirm email* on. (The database
   requires a confirmed email regardless of this setting.) Supabase's built-in email sender is
   heavily rate-limited — for a real team, set up your own SMTP sender under
   *Authentication → SMTP Settings*, or add each person yourself under
   *Authentication → Users → Add user → Auto Confirm*.
7. Set `CLOUD_SYNC = true`, deploy, then sign up (or, if you upgraded, sign in with the email that was
   already on your staff list). If you had data in a
   browser before, open **Settings → Data → Upload this browser's data** once (records that already
   exist in the database are never overwritten, and the browser's own copy is kept as a backup).
8. Add your team under **Employees**, tick **Can sign in**, and ask them to create their login with
   that email address.

If you turn `CLOUD_SYNC` on before steps 2–4 are done, the login page (or a "database isn't set
up yet" screen) tells you what's missing and the app stays locked — it fails closed.

### Good to know

* **It needs an internet connection.** Screens you've already opened keep showing what they had
  and the top bar shows **Offline**, but changes are refused (with a clear message) rather than
  queued: stock is shared, so a sale recorded later, blind, could oversell what someone else has
  already sold. Reconnecting re-syncs everything.
* **Busy history is windowed.** Sales and online orders load the last 45 days, stock movements,
  activity and notifications the last 30 (older records stay in the database and open by id — for
  example when processing a return). This keeps screens fast and downloads small as years of
  history pile up.
* **Live updates fall back gracefully.** If Realtime can't connect, the top bar says
  *Connecting…* and screens re-read every 30 seconds instead.
* **The free Supabase plan** pauses a project after a week with no activity (one click to resume)
  and doesn't include restorable backups — export what matters now and then.
* **Changing the store currency or tax rate** on one device shows everyone else a "reload to use
  them" notice; the shop name updates live.
* **Clear All Data / Load Sample Data are hidden** while sharing is on — wiping shared data from one
  screen could hurt everyone. Use the Supabase Table Editor to start over.

### Testing without a Supabase project

`supabase/schema.sql` and the client were tested against a real PostgreSQL 17 and PostgREST 16
(the REST layer Supabase uses) with small local stand-ins for Supabase's login, storage and
live-update servers — including two simultaneous "devices", races for the last unit, going
offline, photos, and the approval flow. Those stand-ins are re-implementations, so the final check
of any deployment is a quick pass against the real project: sign up, confirm, approve, and watch a
change appear on a second device.

## Integrations (Shopify, WooCommerce, Stripe, Paystack, Hubtel)

**Settings → Integrations** lets the Shop Owner connect each service. It needs live sharing on
(`CLOUD_SYNC = true`), because the keys must be kept safely in your database.

**What's built:** for each provider you enter your keys, the app checks they work by asking the
provider, and the card shows an honest status — *Not connected*, *Saved — not verified*, *Connected*
or *Problem* (with the reason). You can update keys, re-test or disconnect (which deletes the keys).
Typos are caught before anything is saved (a Paystack key must start `pk_`/`sk_`, a Shopify store
address must end `.myshopify.com`, a WooCommerce address must be `https`, …).

**What's NOT built yet:** *using* a connection. Taking a Paystack/Stripe/Hubtel payment at the POS,
importing Shopify/WooCommerce orders, pushing stock levels back to a store, and sending SMS receipts
are separate features that build on these connections.

### How your keys are protected

* **Write-only.** Keys are saved through a database function (`save_integration`, owner only). No screen,
  API call or query in the app can read a saved key back — not staff, not even the owner. The
  `integration_secrets` table has no read access for any signed-in role. You can replace a key, never view it.
* **Only the server uses them.** "Test connection" runs the `integrations` Edge Function
  (`supabase/functions/integrations/index.ts`), which reads the key with the server-side service key, calls the
  provider, and returns just "connected / not connected and why" — never the key. It only runs for the Shop
  Owner (checked against the database), refuses unsafe addresses (only `*.myshopify.com` for Shopify; only public
  https sites for WooCommerce — never localhost or private networks) and does not follow redirects.
* Disconnecting deletes the stored keys. Keys are stored in your Supabase database (encrypted at rest by
  Supabase); if you want column-level encryption as well, look at Supabase Vault.

### One-time setup

1. **Update the database:** run the latest `supabase/schema.sql` again in the SQL Editor (safe to re-run) — it adds
   the `integrations` and `integration_secrets` tables and the two functions.
2. **Deploy the checker:** Supabase dashboard → **Edge Functions → Deploy a new function**, name it exactly
   `integrations`, paste the contents of `supabase/functions/integrations/index.ts`, and deploy. (Or with the CLI:
   `supabase functions deploy integrations`.) Supabase supplies its keys to the function automatically.
   Until this is done, **Connect** still saves the keys but shows *Saved — not verified*.
3. Open **Settings → Integrations** as the owner and press **Connect** on a provider.

### Per-provider notes

| Provider | You'll need | "Test connection" does |
|---|---|---|
| Paystack | public + secret key | asks Paystack for your balance |
| Stripe | publishable + secret key | asks Stripe for your balance (a restricted key needs "Balance: read") |
| Shopify | `your-store.myshopify.com` + Admin API access token | reads the shop's name |
| WooCommerce | https shop address + REST consumer key & secret (Read/Write) | reads one product |
| Hubtel | SMS sender name + Client ID + Client Secret | nothing automatically — Hubtel has no free key check, so use **Send test SMS** to confirm |

**Verification status:** the database rules are tested against real PostgreSQL (27 checks, including "nobody can read a
secret"), the Edge Function against pretend provider answers (52 checks), and the Settings screen in a real browser
(36 checks). It has **not** been run against real Paystack/Stripe/Shopify/WooCommerce/Hubtel accounts — those calls follow
each provider's public documentation, but the first *Test connection* on a real account is the true test. Hubtel's SMS
endpoint in particular should be confirmed with a real test message.

## Core modules (navigation)

Overview: Dashboard, Notifications, Activity Logs
Catalog: Products, Categories, Brands, Suppliers
Inventory: Inventory, Purchase Orders, Stock Transfers, Warehouse
Sales: POS, Sales, Invoices, Online Orders, Returns, Customers
Insights: Reports, Analytics
Organization: Employees, Settings
Public: Login (`pages/login.html`)

Adding a 21st module: add one entry to `assets/js/config/nav.config.js`
and one HTML page under `pages/` using the existing page shell — no
other file needs to change.

## Phase plan

1. **Project Architecture** — done
2. **UI Design System** — done (`pages/design-system.html`)
3. **Dashboard** — done (`pages/dashboard.html`, `notifications.html`, `activity-logs.html`) — live KPIs, Chart.js charts, full notification center, full audit trail
4. **Products** — done (`pages/products.html`, `categories.html`, `brands.html`, `suppliers.html`) — full catalog CRUD, variants, barcode generation
5. **Inventory** — done (`pages/inventory.html`, `purchase-orders.html`, `stock-transfers.html`, `warehouse.html`) — stock adjustments, counts, transfers, CSV bulk import/export, barcode scan search
6. **POS** — done (`pages/pos.html`) — cart, barcode scan, discounts, tax, cash/card/mobile money/split payment, printable receipts
7. **Online Orders** — done (`pages/online-orders.html`, `sales.html`, `returns.html`, `customers.html`) — order sync (simulated), returns, unified customer directory
8. **Reports** — done (`pages/reports.html`, `analytics.html`) — Chart.js-powered reporting suite across 10 report types
9. **Settings** — done (`pages/employees.html`, `settings.html`) — store profile, tax/currency, roles & permissions preview, integrations
10. API Integration — Node/Express + DB + payment providers + Shopify/WooCommerce

Each phase is implemented and reviewed before the next begins.
