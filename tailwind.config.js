/**
 * tailwind.config.js — compiled build replacing the Tailwind Play CDN.
 * The CDN (assets/js/config/tailwind.init.js, now retired) logs a
 * "should not be used in production" warning and recompiles utilities
 * with an in-browser JIT on every page load; this config drives a
 * one-time `npm run build:css` instead, producing a static
 * assets/css/tailwind.css checked into the repo.
 *
 * `theme.extend` below is carried over verbatim from tailwind.init.js —
 * same color scale, fonts, radii and animations, so no visual change.
 */
module.exports = {
  content: [
    './index.html',
    './pages/**/*.html',
    './components/**/*.html',
    './assets/js/**/*.js',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81',
        },
        success: { 500: '#10b981', 100: '#d1fae5' },
        warning: { 500: '#f59e0b', 100: '#fef3c7' },
        danger:  { 500: '#ef4444', 100: '#fee2e2' },
        info:    { 500: '#3b82f6', 100: '#dbeafe' },
        surface: {
          base: 'var(--surface-base)',
          raised: 'var(--surface-raised)',
          sunken: 'var(--surface-sunken)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
      },
      borderRadius: {
        xl2: '1.5rem',
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgb(15 23 42 / 0.10)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-up': { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out both',
        'slide-up': 'slide-up 300ms cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
  plugins: [],
};
