import { motion, useReducedMotion } from 'motion/react';

import { barLengths, histogramBins } from '../../lib/charts';
import { formatNumber } from '../../lib/format';
import { DURATION, EASE, staggerDelay } from '../../lib/motion';

const HEIGHT = 72;
const GAP = 3;
const COLUMN = 24;
const LABELS = 16;

/**
 * A distribution of values over the bins the caller fixes by `edges` (openspec:
 * changes/viewer-learn, design D6), drawn as SVG columns: each as tall as its
 * count over the largest count. The first and last edges are written below.
 * Values outside the edges are counted and said under the chart, not dropped.
 * Columns grow from the baseline in turn; with reduced motion they are drawn at
 * their height at once.
 */
export function Histogram({ values, edges, label, format = formatNumber }: {
  values: readonly number[];
  edges: readonly number[];
  label: string;
  format?: (value: number) => string;
}) {
  const reduce = useReducedMotion();
  const { bins, outside } = histogramBins(values, edges);
  const heights = barLengths(bins.map((bin) => bin.count), HEIGHT);
  const width = bins.length * COLUMN + (bins.length - 1) * GAP;
  const text = bins.map((bin) => `${format(bin.from)} to ${format(bin.to)}: ${formatNumber(bin.count)}`).join(', ');
  return (
    <figure className="m-0">
      <svg role="img" aria-label={`${label}: ${text}`} data-xv-histogram={bins.length} className="block h-auto w-full overflow-visible" viewBox={`0 0 ${width} ${HEIGHT + LABELS}`}>
        <line x1={0} y1={HEIGHT} x2={width} y2={HEIGHT} className="stroke-line-2" strokeWidth={1} />
        {bins.map((bin, i) => (
          <motion.rect
            key={`${bin.from}-${bin.to}`}
            data-xv-bin={i}
            data-xv-bin-count={bin.count}
            x={i * (COLUMN + GAP)}
            y={HEIGHT - heights[i]}
            width={COLUMN}
            height={heights[i]}
            rx={2}
            style={{ fill: 'var(--color-accent)', originY: 1 }}
            initial={reduce ? false : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: DURATION.view, ease: EASE, delay: staggerDelay(i) }}
          >
            <title>{`${format(bin.from)} to ${format(bin.to)}: ${formatNumber(bin.count)}`}</title>
          </motion.rect>
        ))}
        <text x={0} y={HEIGHT + 13} className="fill-muted text-[10px]">{format(edges[0])}</text>
        <text x={width} y={HEIGHT + 13} textAnchor="end" className="fill-muted text-[10px]">{format(edges[edges.length - 1])}</text>
      </svg>
      {outside > 0 ? <figcaption data-xv-histogram-outside={outside} className="mt-1 text-xs text-muted">{`${formatNumber(outside)} outside the bins`}</figcaption> : null}
    </figure>
  );
}
