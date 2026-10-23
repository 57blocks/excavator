import { motion, useReducedMotion } from 'motion/react';

import { barLengths } from '../../lib/charts';
import { formatNumber } from '../../lib/format';
import { DURATION, EASE, staggerDelay } from '../../lib/motion';

/** The bar track's length: a bar's width is its share of 100, in per cent of the track. */
export const BAR_TRACK = 100;

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** The bar's colour (a CSS colour or var()); the accent by default. */
  colour?: string;
}

/**
 * Horizontal bars with their values (openspec: changes/viewer-learn, design
 * D6), drawn as SVG: each bar is as long as its value over the largest, so the
 * largest fills the track and 0 draws nothing. Bars grow from 0 in turn when
 * they enter; with reduced motion they are drawn at their length at once.
 * `onSelect` makes each row a button.
 */
export function BarList({ rows, label, format = formatNumber, onSelect }: {
  rows: readonly BarRow[];
  /** What the list shows, for assistive technology. */
  label: string;
  format?: (value: number) => string;
  onSelect?: (row: BarRow) => void;
}) {
  const reduce = useReducedMotion();
  const lengths = barLengths(rows.map((row) => row.value), BAR_TRACK);
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row, i) => {
        const content = (
          <>
            <span className="min-w-0 truncate text-left text-[13px] text-ink-soft" title={row.label}>{row.label}</span>
            <svg aria-hidden="true" className="block h-2 w-full overflow-visible">
              <rect x={0} y={0} width="100%" height={8} rx={4} className="fill-paper-2" />
              <motion.rect
                data-xv-bar={row.key}
                x={0}
                y={0}
                width={`${lengths[i]}%`}
                height={8}
                rx={4}
                style={{ fill: row.colour ?? 'var(--color-accent)', originX: 0 }}
                initial={reduce ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: DURATION.view, ease: EASE, delay: staggerDelay(i) }}
              />
            </svg>
            <span className="text-right font-mono text-xs text-ink">{format(row.value)}</span>
          </>
        );
        const grid = 'grid w-full grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-3';
        return (
          <li key={row.key} data-xv-bar-row={row.key}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(row)} className={`${grid} cursor-pointer rounded-control border-0 bg-transparent px-1 py-0.5 hover:bg-paper`}>
                {content}
              </button>
            ) : (
              <div className={`${grid} px-1 py-0.5`}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
