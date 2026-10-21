/**
 * The page's signals to the outside world (the report-viewer convention the
 * smoke and acceptance scripts read): `data-xv-ready` on <html> is "1" once the
 * first content is drawn, or "error" when the page could not be drawn, and each
 * total the page shows is a `data-xv-count-<name>` attribute.
 */

const COUNT_PREFIX = 'data-xv-count-';

export function setReady(state: '1' | 'error') {
  document.documentElement.setAttribute('data-xv-ready', state);
}

export function clearReady() {
  document.documentElement.removeAttribute('data-xv-ready');
}

export function setCount(name: string, value: number) {
  document.documentElement.setAttribute(`${COUNT_PREFIX}${name}`, String(value));
}

export function clearCount(name: string) {
  document.documentElement.removeAttribute(`${COUNT_PREFIX}${name}`);
}

/** Publish a measurement that is not a total (an elapsed time, the place the page is at) as `data-xv-<name>`. */
export function setSignal(name: string, value: string) {
  document.documentElement.setAttribute(`data-xv-${name}`, value);
}

export function clearSignal(name: string) {
  document.documentElement.removeAttribute(`data-xv-${name}`);
}
