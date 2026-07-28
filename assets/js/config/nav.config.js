/**
 * nav.config.js — single source of truth for the sidebar navigation.
 * Add a module here once and it appears in the sidebar, mobile drawer,
 * and global search index automatically. `key` must match the page's
 * `data-page` attribute on <body> so the active-link highlight works.
 */
export const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high', href: 'dashboard.html' },
      { key: 'notifications', label: 'Notifications', icon: 'fa-bell', href: 'notifications.html' },
      { key: 'activity-logs', label: 'Activity Logs', icon: 'fa-clock-rotate-left', href: 'activity-logs.html' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { key: 'products', label: 'Products', icon: 'fa-box', href: 'products.html' },
      { key: 'categories', label: 'Categories', icon: 'fa-layer-group', href: 'categories.html' },
      { key: 'brands', label: 'Brands', icon: 'fa-tags', href: 'brands.html' },
      { key: 'suppliers', label: 'Suppliers', icon: 'fa-truck-field', href: 'suppliers.html' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { key: 'inventory', label: 'Inventory', icon: 'fa-warehouse', href: 'inventory.html' },
      { key: 'purchase-orders', label: 'Purchase Orders', icon: 'fa-file-invoice', href: 'purchase-orders.html' },
      { key: 'stock-transfers', label: 'Stock Transfers', icon: 'fa-right-left', href: 'stock-transfers.html' },
      { key: 'warehouse', label: 'Warehouse', icon: 'fa-boxes-packing', href: 'warehouse.html' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { key: 'pos', label: 'POS', icon: 'fa-cash-register', href: 'pos.html' },
      { key: 'sales', label: 'Sales', icon: 'fa-receipt', href: 'sales.html' },
      { key: 'online-orders', label: 'Online Orders', icon: 'fa-cart-shopping', href: 'online-orders.html' },
      { key: 'returns', label: 'Returns', icon: 'fa-rotate-left', href: 'returns.html' },
      { key: 'customers', label: 'Customers', icon: 'fa-users', href: 'customers.html' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { key: 'reports', label: 'Reports', icon: 'fa-chart-column', href: 'reports.html' },
      { key: 'analytics', label: 'Analytics', icon: 'fa-chart-line', href: 'analytics.html' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { key: 'employees', label: 'Employees', icon: 'fa-id-badge', href: 'employees.html' },
      { key: 'settings', label: 'Settings', icon: 'fa-gear', href: 'settings.html' },
    ],
  },
];

/** Flattened list, handy for global search indexing. */
export const NAV_ITEMS_FLAT = NAV_GROUPS.flatMap((g) => g.items);
