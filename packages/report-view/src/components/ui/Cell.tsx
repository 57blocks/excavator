import type { ReactNode } from 'react';

import { EMPTY, NOT_PROVIDED } from '../../lib/format';

/** A cell's content: a missing value (null, '' or the empty-value dash) shows as a muted dash; a field the product lacks says so. */
export function cellContent(value: ReactNode): ReactNode {
  if (value === NOT_PROVIDED) return <span className="text-muted">{NOT_PROVIDED}</span>;
  if (value === null || value === undefined || value === '' || value === EMPTY) return <span className="text-muted">{EMPTY}</span>;
  return value;
}
