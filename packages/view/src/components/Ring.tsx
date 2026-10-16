// Language ring (donut) in inline SVG. Slices past the categorical slots fold
// into one "Other" slice; the legend lists every slice with its count, so
// identity never rests on color alone.
import { OTHER_COLOR } from '../model/colors';
import { fmtNumber } from '../format';

export interface RingSlice {
  label: string;
  value: number;
  color: string;
}

export function foldSlices(order: string[], values: Map<string, number>, colors: Map<string, string>): RingSlice[] {
  const slices: RingSlice[] = [];
  let other = 0;
  let otherCount = 0;
  for (const language of order) {
    const value = values.get(language) ?? 0;
    const color = colors.get(language) ?? OTHER_COLOR;
    if (color === OTHER_COLOR) {
      other += value;
      otherCount += 1;
    } else slices.push({ label: language, value, color });
  }
  if (otherCount > 0) slices.push({ label: `Other (${otherCount} languages)`, value: other, color: OTHER_COLOR });
  return slices;
}

export function Ring({ slices, centerLabel }: { slices: RingSlice[]; centerLabel: string }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const size = 180;
  const r = 70;
  const stroke = 26;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="ring-layout">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Files by language: ${centerLabel}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {total > 0 &&
          slices.map((slice) => {
            const length = (slice.value / total) * circumference;
            // A 2px surface gap between slices (when there is more than one).
            const gap = slices.length > 1 && length > 3 ? 2 : 0;
            const el = (
              <circle
                key={slice.label}
                className="chart-mark"
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={slice.color}
                strokeWidth={stroke}
                strokeDasharray={`${Math.max(length - gap, 0)} ${circumference}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              >
                <title>{`${slice.label}: ${fmtNumber(slice.value)} files (${((slice.value / total) * 100).toFixed(1)}%)`}</title>
              </circle>
            );
            offset += length;
            return el;
          })}
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" style={{ fontSize: 20, fontWeight: 600, fill: 'var(--text-primary)' }}>
          {fmtNumber(total)}
        </text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" style={{ fontSize: 11 }}>
          {centerLabel}
        </text>
      </svg>
      <div className="ring-legend">
        {slices.map((slice) => (
          <div className="row" key={slice.label}>
            <span className="swatch" style={{ background: slice.color }} />
            <span>{slice.label}</span>
            <span className="muted mono">{fmtNumber(slice.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
