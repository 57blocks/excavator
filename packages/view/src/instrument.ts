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
