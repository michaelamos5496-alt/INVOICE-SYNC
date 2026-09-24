/**
 * formatters.js — presentation-only helpers. No business logic here.
 * (formatCurrency reads the shop's currency setting as its default; everything
 * else is a pure function.)
 */

import { CURRENCIES, getCurrency } from '../services/settings.service.js';

const formatterCache = new Map();

function currencyFormatter(currency, decimals) {
  const key = `${currency}:${decimals}`;
  if (!formatterCache.has(key)) {
    const locale = CURRENCIES.find((c) => c.code === currency)?.locale ?? 'en-US';
    formatterCache.set(key, new Intl.NumberFormat(locale, {
      style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }));
  }
  return formatterCache.get(key);
}

/**
 * Formats a money amount. With no `currency` given it uses the shop's currency
 * from Settings, so every screen follows that setting automatically. Pass one
 * explicitly only for a document that must keep the currency it was issued in
 * (see invoices). `decimals: 0` gives compact figures for chart axes.
 */
export function formatCurrency(amount, currency = getCurrency(), { decimals = 2 } = {}) {
  const value = Number(amount ?? 0);
  try {
    return currencyFormatter(currency, decimals).format(value);
  } catch {
    return `${currency} ${value.toFixed(decimals)}`; // unknown currency code — still show something sensible
  }
}

export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value ?? 0));
}

export function formatPercent(value, fractionDigits = 1) {
  return `${Number(value ?? 0).toFixed(fractionDigits)}%`;
}

export function formatDate(dateInput, opts = {}) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...opts });
}

export function formatDateTime(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return date.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function timeAgo(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const steps = [
    [60, 'sec'], [60, 'min'], [24, 'hr'], [7, 'day'], [4.345, 'wk'], [12, 'mo'], [Infinity, 'yr'],
  ];
  let unit = 'sec';
  let value = seconds;
  for (const [size, label] of steps) {
    if (value < size) { unit = label; break; }
    value = Math.floor(value / size);
    unit = label;
  }
  return value <= 1 && unit === 'sec' ? 'just now' : `${value} ${unit}${value !== 1 ? 's' : ''} ago`;
}

export function slugify(text) {
  return String(text).toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function truncate(text, maxLength = 60) {
  const str = String(text ?? '');
  return str.length > maxLength ? `${str.slice(0, maxLength - 1)}…` : str;
}

export function initials(name) {
  return String(name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
