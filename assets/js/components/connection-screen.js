/**
 * connection-screen.js — a full-screen "can't reach the shop's database" message
 * with a Retry button, shown instead of a half-broken page when the app can't
 * load its shared data (offline, or the database is unreachable).
 */
export function showConnectionProblem({ title = 'Can\'t reach your shop\'s data', message = 'Check your internet connection, then try again. Nothing has been lost.' } = {}) {
  document.body.classList.add('auth-ready'); // app pages stay hidden until this is set (see main.css) — reveal this message
  document.getElementById('connection-problem')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'connection-problem';
  overlay.className = 'fixed inset-0 z-[95] grid place-items-center p-6';
  overlay.style.background = 'var(--surface-base)';
  overlay.setAttribute('role', 'alert');
  overlay.innerHTML = `
    <div class="card p-8 max-w-md w-full text-center space-y-4">
      <span class="inline-grid place-items-center w-14 h-14 rounded-2xl" style="background: var(--surface-sunken); color: var(--text-muted)">
        <i class="fa-solid fa-wifi text-xl" aria-hidden="true"></i>
      </span>
      <h1 class="font-display text-xl font-bold"></h1>
      <p class="text-sm text-[var(--text-secondary)]"></p>
      <button type="button" class="btn btn-primary btn-lg w-full"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Try again</button>
    </div>`;
  overlay.querySelector('h1').textContent = title;
  overlay.querySelector('p').textContent = message;
  overlay.querySelector('button').addEventListener('click', () => window.location.reload());
  document.body.append(overlay);
}

/** True for the kinds of failure that just mean "no connection" (as opposed to "you're not allowed"). */
export const isConnectionError = (error) => !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed|timed out/i.test(error?.message ?? '');

/** Picks the right message for a startup failure: not set up yet vs. simply unreachable. */
export function connectionProblemFor(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  if (/PGRST20[25]|42P01|schema cache|could not find the table|is_staff/i.test(text)) {
    return {
      title: 'The database isn\'t set up yet',
      message: 'Run supabase/schema.sql in your Supabase project\'s SQL Editor (see the README), then reload this page.',
    };
  }
  return undefined; // default "can't reach your data" wording
}
