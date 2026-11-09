import { Children, isValidElement, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { useText } from '../../lib/text';

/** Rows shown at a time (design D6 of openspec change handbook-page-chunked-data). */
export const PAGE_SIZE = 200;

/**
 * The page of a list of `total` rows: the first row index and the page number, kept per list. A list whose
 * length changes (a filter ran) starts again at the first page.
 */
export function usePage(total: number): { page: number; pages: number; start: number; end: number; go: (page: number) => void } {
  const [state, setState] = useState({ total, page: 0 });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = state.total !== total ? 0 : Math.min(state.page, pages - 1);
  if (state.total !== total) setState({ total, page: 0 });
  return { page, pages, start: page * PAGE_SIZE, end: Math.min(total, (page + 1) * PAGE_SIZE), go: (next) => setState({ total, page: Math.max(0, Math.min(pages - 1, next)) }) };
}

/** The controls under a list that is shown a page at a time: the page and rows shown, and the previous and next buttons. */
export function Pager({ total, page, pages, start, end, go }: { total: number } & ReturnType<typeof usePage>) {
  const t = useText();
  return (
    <nav className="pager" data-part="pager" aria-label={t('page.paging.label')}>
      <button type="button" data-part="pager-previous" disabled={page === 0} onClick={() => go(page - 1)}>{t('page.paging.previous')}</button>
      <span className="pager-status" aria-live="polite">{t('page.paging.status', { page: page + 1, pages, from: start + 1, to: end, total })}</span>
      <button type="button" data-part="pager-next" disabled={page >= pages - 1} onClick={() => go(page + 1)}>{t('page.paging.next')}</button>
    </nav>
  );
}

/** `children` as an array of nodes (arrays and fragments of one `.map` are flattened). */
export const nodesOf = (children: ReactNode): ReactNode[] => Children.toArray(children);

/** The `<tbody>` element among `nodes`, if there is one. */
export const bodyOf = (nodes: ReactNode[]): ReactElement<{ children?: ReactNode }> | undefined =>
  nodes.find((node): node is ReactElement<{ children?: ReactNode }> => isValidElement(node) && node.type === 'tbody');
