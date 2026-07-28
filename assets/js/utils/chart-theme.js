/**
 * chart-theme.js — reads the app's CSS custom properties so every Chart.js
 * instance (Dashboard now; Reports/Analytics in Phase 8) matches the design
 * tokens and updates automatically when the user toggles dark mode.
 */
export function getChartColors() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;

  return {
    primary: read('--color-primary-500', '#6366f1'),
    primaryFaint: 'color-mix(in srgb, ' + read('--color-primary-500', '#6366f1') + ' 18%, transparent)',
    success: read('--color-success-500', '#10b981'),
    warning: read('--color-warning-500', '#f59e0b'),
    danger: read('--color-danger-500', '#ef4444'),
    info: read('--color-info-500', '#3b82f6'),
    textSecondary: read('--text-secondary', '#475569'),
    textMuted: read('--text-muted', '#94a3b8'),
    gridLine: read('--border-subtle', '#e2e8f0'),
    surfaceRaised: read('--surface-raised', '#ffffff'),
  };
}

/** Sensible shared defaults so every chart page doesn't repeat this. */
export function applyChartDefaults(Chart) {
  const c = getChartColors();
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color = c.textMuted;
  Chart.defaults.borderColor = c.gridLine;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.backgroundColor = c.surfaceRaised;
  Chart.defaults.plugins.tooltip.titleColor = c.textSecondary;
  Chart.defaults.plugins.tooltip.bodyColor = c.textSecondary;
  Chart.defaults.plugins.tooltip.borderColor = c.gridLine;
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
}
