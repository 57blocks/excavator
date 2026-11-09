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

/** The technical view's source positions of one unit: each item that carries a citation with the file and lines of each passage quoted for it. */
export function Locations({ unit, id = 'locations', title }: { unit: UnitLocations; id?: string; title?: string }) {
  const t = useText();
  const heading = title ?? t('md.locations.heading');
  return (
    <section className="section" aria-labelledby={`sec-${id}`} data-part="locations">
      <h2 className="section-title" id={`sec-${id}`}>{heading}</h2>
      <p className="muted summary-note">{t('md.locations.note')}</p>
      {unit.items.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <ul className="plain-list">
          {unit.items.map((item, at) => (
            <li key={at}>{t('md.locations.item', { claim: item.claim, places: item.citations.map((place) => placeText(t, place)).join('; ') })}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
