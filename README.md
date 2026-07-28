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
rows), and images (URL-based for now) — via a tabbed add/edit modal.
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
page opened with 12.5 already in its tax input). Integrations
(Shopify, WooCommerce, Stripe, Paystack, Hubtel) are static
"Not Connected" cards with disabled Connect buttons — real OAuth/API-key
flows are Phase 10 work; this phase just gives them a home. Remaining
module pages are still scaffolded placeholders.

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

## Core modules (navigation)

Overview: Dashboard, Notifications, Activity Logs
Catalog: Products, Categories, Brands, Suppliers
Inventory: Inventory, Purchase Orders, Stock Transfers, Warehouse
Sales: POS, Sales, Online Orders, Returns, Customers
Insights: Reports, Analytics
Organization: Employees, Settings

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
