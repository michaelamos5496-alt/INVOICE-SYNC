/**
 * stat-card.js — renders the KPI tiles used across Dashboard/Reports.
 * Pure render function returning an HTML string, kept framework-free so
 * it can be dropped into any grid with template literals.
 */
export function statCardHTML({ label, value, icon, tone = 'primary', trend }) {
  const trendHTML = trend
    ? `<span class="stat-trend ${trend.direction === 'down' ? 'down' : 'up'}">
         <i class="fa-solid ${trend.direction === 'down' ? 'fa-arrow-trend-down' : 'fa-arrow-trend-up'}"></i>
         ${trend.value}
       </span>`
    : '';

  return `
    <div class="card card-hover stat-card">
      <div class="flex items-start justify-between">
        <div>
          <p class="text-sm text-[var(--text-secondary)]">${label}</p>
          <p class="font-display text-2xl font-bold mt-1">${value}</p>
          ${trendHTML}
        </div>
        <span class="stat-icon text-${tone}-500" style="background: var(--color-${tone}-100);">
          <i class="fa-solid ${icon}"></i>
        </span>
      </div>
    </div>
  `;
}

export function renderStatCards(container, stats) {
  if (!container) return;
  container.innerHTML = stats.map(statCardHTML).join('');
}
