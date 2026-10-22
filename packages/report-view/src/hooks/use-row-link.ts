import { useCallback } from 'react';

import { detailParams, withParams } from '../lib/detail-rows';
import { navigate, useRoute } from './use-route';

/**
 * The `row` and `prefix` of the detail page's address (openspec: changes/viewer-learn, design D5), with the moves
 * that change them. Each move is a history entry, so back closes a panel that a click opened and returns a filter.
 */
export function useRowLink() {
  const { route } = useRoute();
  const { row, prefix } = detailParams(route.params);
  const open = useCallback((key: string, changes: Record<string, string | null> = {}) => navigate(withParams(route, { ...changes, row: key })), [route]);
  const close = useCallback(() => navigate(withParams(route, { row: null })), [route]);
  const clearPrefix = useCallback(() => navigate(withParams(route, { prefix: null })), [route]);
  const set = useCallback((changes: Record<string, string | null>) => navigate(withParams(route, changes)), [route]);
  return { route, row, prefix, open, close, clearPrefix, set };
}
