import type { ReactNode } from 'react';

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** A template with its `{name}` placeholders replaced by their values, each value in a `strong` (ink weight); a name without a value stays as written. */
export function emphasised(template: string, values: Record<string, string | number>): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const at = match.index as number;
    if (at > cursor) out.push(template.slice(cursor, at));
    out.push(Object.prototype.hasOwnProperty.call(values, match[1]) ? <strong key={at}>{values[match[1]]}</strong> : match[0]);
    cursor = at + match[0].length;
  }
  if (cursor < template.length) out.push(template.slice(cursor));
  return out;
}
