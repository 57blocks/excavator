// Page-side counters for the smoke check. The inline script in index.html
// starts counting window errors, unhandled rejections and CSP violations
// before any module runs; caught failures the page handles itself (a bundle
// that does not decode, a render error) are added here.

interface Counters {
  errors: number;
  csp: number;
}

function counters(): Counters {
  const w = window as unknown as { __excavatorViewCounters?: Counters };
  w.__excavatorViewCounters ??= { errors: 0, csp: 0 };
  return w.__excavatorViewCounters;
}

export function countError(): void {
  const c = counters();
  c.errors += 1;
  document.getElementById('root')?.setAttribute('data-errors', String(c.errors));
}

export function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Pending asynchronous work a view started (a search query in the Worker).
// While any is pending, #root carries data-busy, so the smoke check waits for
// the view's answer instead of reading a half-rendered page.
const busy = new Set<string>();

function publishBusy(): void {
  const root = document.getElementById('root');
  if (!root) return;
  if (busy.size === 0) root.removeAttribute('data-busy');
  else root.setAttribute('data-busy', [...busy].sort().join(' '));
}

export function markBusy(key: string): void {
  busy.add(key);
  publishBusy();
}

export function clearBusy(key: string): void {
  busy.delete(key);
  publishBusy();
}

/** Set (or, with null, remove) a self-report attribute on #root. */
export function report(name: string, value: string | number | null): void {
  const root = document.getElementById('root');
  if (!root) return;
  if (value === null) root.removeAttribute(name);
  else root.setAttribute(name, String(value));
}
