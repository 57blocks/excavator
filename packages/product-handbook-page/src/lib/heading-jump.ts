/** Sent to a heading the page is about to show: a feature page answers by selecting the tab and opening the folds that hold it. */
export const REVEAL_EVENT = 'xv-reveal';

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Scroll to the heading `h-<index>` of the chapter `chapter` and focus it, waiting for it when the chapter's text is not on
 * the page yet (a part file that loads later). The heading counts only inside that chapter's own article, so the page being
 * left cannot answer for it. Gives up after `timeout` milliseconds; returns a function that stops the wait.
 */
export function jumpToHeading(chapter: string, index: number, timeout = 10000): () => void {
  const find = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-chapter=${JSON.stringify(chapter)}] #h-${index}`);
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const stop = (): void => {
    stopped = true;
    observer?.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
  const arrive = (heading: HTMLElement): void => {
    stop();
    heading.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
    // After the render that follows the route change, which also scrolls to the top.
    window.requestAnimationFrame(() => {
      heading.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      heading.focus({ preventScroll: true });
    });
  };
  const first = find();
  if (first !== null) { arrive(first); return stop; }
  if (typeof MutationObserver === 'undefined') return stop;
  observer = new MutationObserver(() => {
    if (stopped) return;
    const heading = find();
    if (heading !== null) arrive(heading);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['id'] });
  timer = setTimeout(stop, timeout);
  return stop;
}
