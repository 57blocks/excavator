/** Whether the reader asked for less motion; scrolling and the target highlight then stay still. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scroll `element` to the top of the reading area (its CSS scroll margin keeps it clear of the bars). The URL
 * fragment is a route, so this never touches it. A closed `<details>` is opened first.
 */
export function scrollToElement(element: HTMLElement, smooth = true): void {
  if (element instanceof HTMLDetailsElement) element.open = true;
  element.scrollIntoView({ behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto', block: 'start' });
}

/** Mark `element` as the target for a moment: an animated wash, or a still outline under reduced motion. */
export function flashElement(element: HTMLElement, ms = 2200): void {
  element.classList.add('is-target');
  window.setTimeout(() => element.classList.remove('is-target'), ms);
}

/** The diagrams above `element` in the document that have not rendered or failed yet. */
export function pendingDiagramsBefore(element: HTMLElement): number {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-diagram="pending"]')).filter((diagram) => element.compareDocumentPosition(diagram) & Node.DOCUMENT_POSITION_PRECEDING).length;
}

/**
 * Keep `element` at the top of the reading area while the page above it settles: diagrams render after the first
 * scroll and change the page's height. It re-aligns only while some diagram above the element is still pending
 * (and once more when the last one finishes), and stops at the first sign of the reader taking over (wheel, touch,
 * key, mouse down) or after `ms`, whichever comes first. Returns the function that stops it earlier.
 */
export function holdInView(element: HTMLElement, column: HTMLElement | null, ms = 12000): () => void {
  const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
  const align = () => {
    const offset = element.getBoundingClientRect().top - margin;
    if (Math.abs(offset) > 4) window.scrollBy({ top: offset, behavior: 'instant' as ScrollBehavior });
  };
  const tick = () => {
    const pending = pendingDiagramsBefore(element);
    align();
    if (pending === 0) stop();
  };
  const observer = typeof ResizeObserver === 'undefined' || column === null ? null : new ResizeObserver(tick);
  observer?.observe(column as Element);
  const timer = window.setTimeout(() => stop(), ms);
  const poll = window.setInterval(tick, 200);
  const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
  function stop() {
    observer?.disconnect();
    window.clearTimeout(timer);
    window.clearInterval(poll);
    events.forEach((name) => window.removeEventListener(name, stop));
  }
  events.forEach((name) => window.addEventListener(name, stop, { passive: true }));
  return stop;
}
