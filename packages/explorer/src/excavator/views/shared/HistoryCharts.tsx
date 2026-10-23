import { areaGeometry, barLengths, histogramBins, type AreaPoint } from "../../products/charts";
import { formatNumber, NOT_PROVIDED } from "../../products/format";
import { scoreShare, sparkBars, yearSeries, yearText } from "../../products/hotspots";

const AREA_HEIGHT = 64;
const AREA_WIDTH = 320;
const PAD_TOP = 4;
/** Room left and right so the dots at the ends are inside the drawing box (an overflowing drawing would widen the page). */
const PAD_X = 4;
const LABELS = 16;

/**
 * An area chart of a value per year, hand-drawn as SVG in the explorer's accent: the line
 * through every point, the area under it, a dot on each point with its value in a tooltip,
 * and the first and last year below. No points, nothing drawn but the note.
 */
export function AreaSpark({ points, label, unit = "commits" }: { points: readonly AreaPoint[]; label: string; unit?: string }) {
  if (points.length === 0) return <p className="text-xs text-text-muted">No values to draw.</p>;
  const { coords, line, area } = areaGeometry(points, AREA_WIDTH, AREA_HEIGHT);
  const text = points.map((p) => `${p.label}: ${formatNumber(p.value)}`).join(", ");
  return (
    <svg role="img" aria-label={`${label}: ${text}`} data-excavator-area={points.length} className="block h-auto w-full" viewBox={`${-PAD_X} ${-PAD_TOP} ${AREA_WIDTH + 2 * PAD_X} ${AREA_HEIGHT + PAD_TOP + LABELS}`}>
      <line x1={0} y1={AREA_HEIGHT} x2={AREA_WIDTH} y2={AREA_HEIGHT} strokeWidth={1} style={{ stroke: "var(--color-border-medium)" }} />
      <path d={area} style={{ fill: "var(--color-accent)", fillOpacity: 0.14 }} />
      <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--color-accent)" }} />
      {coords.map(([x, y], i) => (
        <circle key={points[i].label} cx={x} cy={y} r={2.5} strokeWidth={1.5} style={{ stroke: "var(--color-accent)", fill: "var(--color-surface)" }}>
          <title>{`${points[i].label}: ${formatNumber(points[i].value)} ${unit}`}</title>
        </circle>
      ))}
      <text x={coords[0][0]} y={AREA_HEIGHT + 13} textAnchor={points.length === 1 ? "middle" : "start"} className="text-[10px]" style={{ fill: "var(--color-text-muted)" }}>{points[0].label}</text>
      {points.length > 1 ? <text x={coords[coords.length - 1][0]} y={AREA_HEIGHT + 13} textAnchor="end" className="text-[10px]" style={{ fill: "var(--color-text-muted)" }}>{points[points.length - 1].label}</text> : null}
    </svg>
  );
}

const HIST_HEIGHT = 72;
const GAP = 3;
const COLUMN = 24;

/**
 * A distribution of values over the bins the caller fixes by `edges`, drawn as SVG columns each as tall as
 * its count over the largest count. Values outside the edges are counted and said under the chart.
 */
export function Histogram({ values, edges, label, format = formatNumber }: { values: readonly number[]; edges: readonly number[]; label: string; format?: (value: number) => string }) {
  const { bins, outside } = histogramBins(values, edges);
  const heights = barLengths(bins.map((bin) => bin.count), HIST_HEIGHT);
  const width = bins.length * COLUMN + (bins.length - 1) * GAP;
  const text = bins.map((bin) => `${format(bin.from)} to ${format(bin.to)}: ${formatNumber(bin.count)}`).join(", ");
  return (
    <figure className="m-0">
      <svg role="img" aria-label={`${label}: ${text}`} data-excavator-histogram={bins.length} className="block h-auto w-full" viewBox={`0 0 ${width} ${HIST_HEIGHT + LABELS}`}>
        <line x1={0} y1={HIST_HEIGHT} x2={width} y2={HIST_HEIGHT} strokeWidth={1} style={{ stroke: "var(--color-border-medium)" }} />
        {bins.map((bin, i) => (
          <rect key={`${bin.from}-${bin.to}`} data-excavator-bin-count={bin.count} x={i * (COLUMN + GAP)} y={HIST_HEIGHT - heights[i]} width={COLUMN} height={heights[i]} rx={2} style={{ fill: "var(--color-accent)", fillOpacity: 0.6 }}>
            <title>{`${format(bin.from)} to ${format(bin.to)}: ${formatNumber(bin.count)}`}</title>
          </rect>
        ))}
        <text x={0} y={HIST_HEIGHT + 13} className="text-[10px]" style={{ fill: "var(--color-text-muted)" }}>{format(edges[0])}</text>
        <text x={width} y={HIST_HEIGHT + 13} textAnchor="end" className="text-[10px]" style={{ fill: "var(--color-text-muted)" }}>{format(edges[edges.length - 1])}</text>
      </svg>
      {outside > 0 ? <figcaption data-excavator-histogram-outside={outside} className="mt-1 text-xs text-text-muted">{`${formatNumber(outside)} outside the bins`}</figcaption> : null}
    </figure>
  );
}

const SPARK_WIDTH = 84;
const SPARK_HEIGHT = 24;

/** One bar per year of commits, in a box of 84 x 24; a product without the field says so, and null is empty. */
export function sparkline(commitsByYear: unknown) {
  const series = yearSeries(commitsByYear);
  if (series === null) return commitsByYear === undefined ? NOT_PROVIDED : null;
  return (
    <svg className="block" width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} role="img" aria-label={`Commits by year: ${yearText(series)}`}>
      <line x1={0} y1={SPARK_HEIGHT} x2={SPARK_WIDTH} y2={SPARK_HEIGHT} strokeWidth={1} style={{ stroke: "var(--color-border-medium)" }} />
      {sparkBars(series, SPARK_WIDTH, SPARK_HEIGHT, 1).map((bar) => (
        <rect key={bar.title} x={bar.x} y={bar.y} width={bar.width} height={bar.height} style={{ fill: "var(--color-accent)", fillOpacity: 0.7 }}>
          <title>{bar.title}</title>
        </rect>
      ))}
    </svg>
  );
}

/** A score beside a bar as wide as its share of the highest score. */
export function scoreCell(score: number | null | undefined, max: number | null) {
  if (score === undefined) return NOT_PROVIDED;
  if (score === null) return null;
  const width = scoreShare(score, max);
  return (
    <span className="flex h-5 items-center justify-end gap-2">
      <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-elevated">
        <span className="block h-full rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--color-accent) 60%, transparent)", ...(width === null ? {} : { width: `${width}%` }) }} />
      </span>
      <span className="min-w-[72px] text-right tabular-nums">{formatNumber(score)}</span>
    </span>
  );
}
