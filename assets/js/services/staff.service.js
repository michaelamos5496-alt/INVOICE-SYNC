/**
 * staff.service.js — who is allowed to sign in (the `staff` table; see supabase/schema.sql).
 *
 * An Employee record is just information about a person. Letting them into the app is a
 * separate, deliberate step — Employees → "Can sign in" — which adds their email to this list.
 * Each shop has its own list, and a person belongs to exactly one shop. Only the shop's owner can
 * change its list; the database enforces both, so these calls fail for anyone else. No-ops entirely while cloud sync is off.
 */
import { CLOUD_SYNC } from '../config/supabase.config.js';
import { getSupabase } from './supabase.service.js';
import { friendlyDataError } from './cloud-data.service.js';

export const staffAccessSupported = () => CLOUD_SYNC;

const normalize = (email) => String(email ?? '').trim().toLowerCase();

async function run(operation) {
  const client = await getSupabase();
  const { data, error } = await operation(client);
  if (error) {
    const message = error.code === 'P0001' ? error.message : error.code === '42501' ? 'Only the shop owner can give or remove sign-in access.' : friendlyDataError(error);
    throw Object.assign(new Error(message), { code: error.code });
  }
  return data;
}

/** @returns {Promise<Map<string, { role: string, name: string }>>} approved staff keyed by lowercase email */
export async function listStaff() {
  if (!CLOUD_SYNC) return new Map();
  const rows = await run((client) => client.from('staff').select('email,role,name'));
  return new Map(rows.map((row) => [row.email, { role: row.role, name: row.name }]));
}

/** Whether the person using the app right now is the Shop Owner (used to show or hide the sign-in controls). */
export async function amIOwner() {
  if (!CLOUD_SYNC) return false;
  const client = await getSupabase();
  const { data } = await client.rpc('is_owner');
  return data === true;
}

export async function grantAccess({ email, role, name }) {
  if (!CLOUD_SYNC) return;
  const address = normalize(email);
  if (!address) throw new Error('Add an email address first — that\'s what they\'ll sign in with.');
  try {
    await run((client) => client.from('staff').upsert({ email: address, role, name: name ?? '' }, { onConflict: 'email' }));
  } catch (err) {
    // The email is already on ANOTHER shop's list: the database refuses to touch that row (a login belongs to one shop only).
    if (err.code === '42501') throw new Error('That email already belongs to another shop, so it can\'t be added to yours. They\'d need to sign in with a different email.');
    throw err;
  }
}

export async function revokeAccess(email) {
  if (!CLOUD_SYNC) return;
  const address = normalize(email);
  if (!address) return;
  const removed = await run((client) => client.from('staff').delete().eq('email', address).select('email'));
  if (!removed?.length) {
    const still = await run((client) => client.from('staff').select('email').eq('email', address));
    if (still.length) throw new Error('Only the shop owner can give or remove sign-in access.');
  }
}
