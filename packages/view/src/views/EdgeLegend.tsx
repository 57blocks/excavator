// Edge type legend with switches (artifact-view tasks 6.4, 7A.2): every
// listed type in fixed order with its fixed color, how many edges the current
// level's drawn links carry and how many its scope holds (`drawn / total`);
// types the page does not list are counted under "other" (and named), never
// dropped. A type with edges in the scope stays switchable even when none is drawn.
import { fmtNumber } from '../format';
import { legendRows } from '../model/legend';

export function EdgeLegend({ drawn, totals, disabled, onToggle }: { drawn: Map<string, number>; totals: Map<string, number>; disabled: ReadonlySet<string>; onToggle: (key: string) => void }) {
  return (
    <ul className="legend edge-legend" aria-label="Edge types (drawn / in this scope)">
      {legendRows(drawn, totals, disabled).map((row) => (
        <li key={row.key} data-edge-legend={row.key} data-edge-count={row.drawn} data-edge-total={row.total} data-enabled={row.off ? 'false' : 'true'}>
          <button
            type="button"
            className="legend-toggle"
            aria-pressed={!row.off}
            onClick={() => onToggle(row.key)}
            disabled={row.disabled}
            title={`${fmtNumber(row.drawn)} edges in drawn links of ${fmtNumber(row.total)} in this scope`}
          >
            <span className="swatch" style={{ background: `var(--edge-${row.key})`, opacity: row.off ? 0.3 : 1 }} />
            {row.key}
            {row.key === 'other' && row.otherTypes.length > 0 && <span className="muted"> ({row.otherTypes.join(', ')})</span>}{' '}
            <span className="muted">
              {fmtNumber(row.drawn)} / {fmtNumber(row.total)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
