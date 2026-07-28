/**
 * empty-state.js — consistent "nothing here yet" placeholder used across
 * every list/table page (no products, no orders, no search results...).
 */
export function renderEmptyState(container, { icon = 'fa-inbox', title = 'Nothing here yet', message = '', actionLabel, onAction }) {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon"><i class="fa-solid ${icon}"></i></span>
      <div>
        <p class="font-display font-semibold">${title}</p>
        ${message ? `<p class="text-sm mt-1 max-w-sm mx-auto">${message}</p>` : ''}
      </div>
      ${actionLabel ? `<button class="btn btn-primary btn-sm mt-2" data-empty-action>${actionLabel}</button>` : ''}
    </div>
  `;
  if (actionLabel && onAction) container.querySelector('[data-empty-action]').addEventListener('click', onAction);
}
