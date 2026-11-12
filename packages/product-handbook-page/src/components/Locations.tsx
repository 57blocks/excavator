import { Fragment, createElement } from 'react';

import { useText } from '../lib/text';
import type { Text } from '../lib/text';
import type { UnitLocations } from '../lib/types';

type Place = UnitLocations['items'][number]['citations'][number];

/** One quoted passage's position: the file and the line, or the lines, or that it could not be located. */
export function placeText(t: Text, place: Place): string {
  if (place.startLine === null || place.endLine === null) return t('md.locations.unlocated', { file: place.file });
  if (place.startLine === place.endLine) return t('md.locations.placeOne', { file: place.file, line: place.startLine });
  return t('md.locations.place', { file: place.file, start: place.startLine, end: place.endLine });
}

/** The fixed separator the claim of an item joins its path and its text with. */
const CLAIM_SEPARATOR = ' > ';

/** The item's path and its claim from the joined string (split at the last separator); the whole string is the claim when it does not split. */
export function splitClaim(joined: string): { path: string | null; claim: string } {
  const at = joined.lastIndexOf(CLAIM_SEPARATOR);
  if (at <= 0 || at + CLAIM_SEPARATOR.length >= joined.length) return { path: null, claim: joined };
  return { path: joined.slice(0, at), claim: joined.slice(at + CLAIM_SEPARATOR.length) };
}

export interface MergedPlace { file: string; spans: string[]; unlocated: boolean; starts?: number[] }

/** The places grouped by file, in the order each file first appears; a repeated span is kept once, and a passage that could not be located makes its own entry. */
export function mergePlaces(places: Place[]): MergedPlace[] {
  const located = new Map<string, MergedPlace>();
  const out: MergedPlace[] = [];
  for (const place of places) {
    if (place.startLine === null || place.endLine === null) {
      out.push({ file: place.file, spans: [], unlocated: true });
      continue;
    }
    const span = place.startLine === place.endLine ? String(place.startLine) : `${place.startLine}-${place.endLine}`;
    let entry = located.get(place.file);
    if (entry === undefined) {
      entry = { file: place.file, spans: [], unlocated: false };
      located.set(place.file, entry);
      out.push(entry);
    }
    if (!entry.spans.includes(span)) {
      entry.spans.push(span);
      (entry.starts ??= []).push(place.startLine);
    }
  }
  // Spans of one file read in line order.
  return out.map(({ starts, ...entry }) => (starts === undefined ? entry : { ...entry, spans: entry.spans.map((span, at) => ({ span, start: starts[at] })).sort((a, b) => a.start - b.start).map((one) => one.span) }));
}

/** A path that may break after each `/`, with a break opportunity the browser takes before it falls back to cutting a word. */
export function BreakablePath({ path }: { path: string }) {
  const parts = path.split('/');
  return (
    <>
      {parts.map((part, at) => (
        <Fragment key={at}>
          {at > 0 && <wbr />}
          {at < parts.length - 1 ? `${part}/` : part}
        </Fragment>
      ))}
    </>
  );
}

/** One `<code>` chip for each file of the places: `file:line`, `file:start-end`, or `file: 12, 40-45` when several places are in the same file. */
export function Chips({ citations }: { citations: Place[] }) {
  const t = useText();
  const merged = mergePlaces(citations);
  if (merged.length === 0) return null;
  return (
    <span className="loc-chips" data-part="location-chips">
      {merged.map((entry, at) => (
        <code className="loc-chip" key={at}>
          {entry.unlocated ? t('md.locations.unlocated', { file: entry.file }) : (
            <>
              <BreakablePath path={entry.file} />
              {entry.spans.length === 1 ? `:${entry.spans[0]}` : `: ${entry.spans.join(', ')}`}
            </>
          )}
        </code>
      ))}
    </span>
  );
}

/** The technical view's source positions of one unit: the items that carry a citation, grouped by item, each with its path, its claim and a chip for each file; collapsed until the reader opens it. */
export function Locations({ unit, id = 'locations', title, level = 2 }: { unit: UnitLocations; id?: string; title?: string; level?: number }) {
  const t = useText();
  const heading = title ?? t('md.locations.heading');
  const citations = unit.items.reduce((sum, item) => sum + item.citations.length, 0);
  return (
    <section className="section" aria-labelledby={`sec-${id}`} data-part="locations">
      {createElement(`h${Math.min(6, level)}`, { className: 'section-title', id: `sec-${id}` }, heading)}
      {unit.items.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <details className="loc-details" data-part="locations-details">
          <summary>{t('page.locations.summary', { items: unit.items.length, citations })}</summary>
          <p className="muted summary-note">{t('md.locations.note')}</p>
          <ul className="loc-list">
            {unit.items.map((item, at) => {
              const { path, claim } = splitClaim(item.claim);
              return (
                <li className="loc-item" key={at}>
                  {path !== null && <p className="loc-path muted">{path}</p>}
                  <p className="loc-claim">{claim}</p>
                  <Chips citations={item.citations} />
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
