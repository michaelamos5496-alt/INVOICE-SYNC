/** Client-generated record ids, e.g. `prod_1727180000000_ab12cd`. Shared by the local and cloud data adapters. */
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
