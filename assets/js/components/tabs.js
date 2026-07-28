/**
 * tabs.js — binds a `.tabs-list` of `.tab-btn[data-tab]` to panels marked
 * `[data-tab-panel]` sharing the same value, inside one container.
 * Usage: initTabs(document.querySelector('#product-tabs'));
 */
export function initTabs(container, { onChange } = {}) {
  if (!container) return;
  const buttons = [...container.querySelectorAll('.tab-btn[data-tab]')];
  const panels = [...container.querySelectorAll('[data-tab-panel]')];

  function activate(key) {
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    panels.forEach((p) => p.classList.toggle('hidden', p.dataset.tabPanel !== key));
    onChange?.(key);
  }

  buttons.forEach((btn) => btn.addEventListener('click', () => activate(btn.dataset.tab)));

  const initial = buttons.find((b) => b.classList.contains('active'))?.dataset.tab ?? buttons[0]?.dataset.tab;
  if (initial) activate(initial);
}
