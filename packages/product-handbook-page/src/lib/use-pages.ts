import { useMemo } from 'react';

import { useView } from './links';
import { pagesOf } from './pages';
import type { PageItem } from './pages';
import { useText } from './text';
import type { PageData } from './types';

/** The pages of the handbook for the view the reader is in, in outline order, the coverage page last. */
export function usePages(data: PageData): PageItem[] {
  const view = useView();
  const t = useText();
  const coverage = t('page.nav.coverage');
  return useMemo(() => pagesOf(data, view, coverage), [data, view, coverage]);
}
