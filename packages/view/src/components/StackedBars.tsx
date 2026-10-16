// Per-language stacked bars in inline SVG: parsed, zero-symbol, then each
// skipped reason. Bars share one scale (the largest language), the row label
// carries the language's ring color, and every segment has a hover title.
import type { LanguageRow } from '../model/coverage';
import { skipColor } from '../model/colors';
import { fmtNumber } from '../format';

export function StackedBars({ rows, skipReasons, colors }: { rows: LanguageRow[]; skipReasons: string[]; colors: Map<string, string> }) {
  const max = Math.max(1, ...rows.map((r) => r.files ?? 0));
  const labelWidth = 150;
  const width = 760;
  const plot = width - labelWidth - 70;
  const rowHeight = 22;
  const height = rows.length * rowHeight + 4;
  const reasonColor = new Map(skipReasons.map((reason, i) => [reason, skipColor(i)]));
  return (
    <div>
      <ul className="legend" aria-label="Outcomes">
        <li>
          <span className="swatch" style={{ background: 'var(--outcome-parsed)' }} /> parsed
        </li>
        <li>
          <span className="swatch" style={{ background: 'var(--outcome-zero)' }} /> zero symbols
        </li>
        {skipReasons.map((reason) => (
          <li key={reason}>
            <span className="swatch" style={{ background: reasonColor.get(reason) }} /> skipped: {reason}
          </li>
        ))}
      </ul>
      <div className="table-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Files per language by outcome" style={{ width: '100%', maxWidth: width, minWidth: 520, height: 'auto', marginTop: 8 }}>
          {rows.map((row, i) => {
            const y = i * rowHeight + 2;
            const segments = [
              { key: 'parsed', label: 'parsed', value: row.parsed ?? 0, color: 'var(--outcome-parsed)' },
              { key: 'zero', label: 'zero symbols', value: row.zeroSymbol ?? 0, color: 'var(--outcome-zero)' },
              ...row.skipped.map((s) => ({ key: `skip-${s.reason}`, label: `skipped: ${s.reason}`, value: s.count ?? 0, color: reasonColor.get(s.reason) ?? skipColor(0) })),
            ].filter((s) => s.value > 0);
            let x = labelWidth;
            return (
              <g key={row.language} data-language={row.language}>
                <rect x={0} y={y + 5} width={8} height={8} rx={2} fill={colors.get(row.language)} />
                <text x={14} y={y + 13} style={{ fontSize: 12 }}>
                  {row.language.length > 18 ? `${row.language.slice(0, 17)}…` : row.language}
                </text>
                {segments.map((segment, s) => {
                  const w = (segment.value / max) * plot;
                  const gap = s < segments.length - 1 && w > 3 ? 2 : 0;
                  const rect = (
                    <rect key={segment.key} className="chart-mark" x={x} y={y + 3} width={Math.max(w - gap, 1)} height={rowHeight - 8} rx={2} fill={segment.color}>
                      <title>{`${row.language} · ${segment.label}: ${fmtNumber(segment.value)}`}</title>
                    </rect>
                  );
                  x += w;
                  return rect;
                })}
                <text x={x + 6} y={y + 13} style={{ fontSize: 11, fill: row.balanced ? 'var(--text-muted)' : 'var(--status-critical-text)' }}>
                  {fmtNumber(row.files)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
