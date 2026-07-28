/**
 * skeleton.js — shimmering loading placeholders shown while api.service.js
 * calls resolve, so lists never pop from blank to populated instantly.
 */
export function renderSkeletonRows(container, { rows = 5, columns = 4 } = {}) {
  if (!container) return;
  container.innerHTML = Array.from({ length: rows }).map(() => `
    <tr>
      ${Array.from({ length: columns }).map(() => `
        <td class="py-3 px-4"><div class="skeleton h-4 w-full max-w-[10rem]"></div></td>
      `).join('')}
    </tr>
  `).join('');
}

export function renderSkeletonCards(container, { count = 4 } = {}) {
  if (!container) return;
  container.innerHTML = Array.from({ length: count }).map(() => `
    <div class="card p-5">
      <div class="skeleton h-9 w-9 !rounded-lg mb-4"></div>
      <div class="skeleton h-3 w-2/3 mb-2"></div>
      <div class="skeleton h-6 w-1/2"></div>
    </div>
  `).join('');
}
