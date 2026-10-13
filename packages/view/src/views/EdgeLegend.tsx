// Edge type legend with switches (artifact-view task 6.4): every listed type
// in fixed order with its fixed color and how many edges of it the current
// level draws; types the page does not list are counted under "other" (and
// named), never dropped.
import { fmtNumber } from '../format';
import { LEGEND_KEYS, edgeTypeKey } from '../model/edge-types';

export function EdgeLegend({ counts, disabled, onToggle }: { counts: Map<string, number>; disabled: ReadonlySet<string>; onToggle: (key: string) => void }) {
  const byKey = new Map<string, number>();
  const otherTypes: string[] = [];
  for (const [type, n] of counts) {
    const key = edgeTypeKey(type);
    byKey.set(key, (byKey.get(key) ?? 0) + n);
    if (key === 'other') otherTypes.push(type);
  }
  return (
    <ul className="legend edge-legend" aria-label="Edge types">
      {LEGEND_KEYS.map((key) => {
        const n = byKey.get(key) ?? 0;
        const off = disabled.has(key);
        return (
          <li key={key} data-edge-legend={key} data-edge-count={n} data-enabled={off ? 'false' : 'true'}>
            <button type="button" className="legend-toggle" aria-pressed={!off} onClick={() => onToggle(key)} disabled={n === 0 && !off}>
              <span className="swatch" style={{ background: `var(--edge-${key})`, opacity: off ? 0.3 : 1 }} />
              {key}
              {key === 'other' && otherTypes.length > 0 && <span className="muted"> ({otherTypes.sort().join(', ')})</span>} <span className="muted">{fmtNumber(n)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
