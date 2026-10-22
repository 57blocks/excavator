import { motion, useReducedMotion } from 'motion/react';

import { areaGeometry, type AreaPoint } from '../../lib/charts';
import { formatNumber } from '../../lib/format';
import { DURATION, EASE } from '../../lib/motion';

const HEIGHT = 64;
const WIDTH = 320;
/** Room above and below the plot for the dots and the year labels. */
const PAD_TOP = 4;
const LABELS = 16;

/**
 * An area chart of a value per year (openspec: changes/viewer-learn, design
 * D6), drawn as SVG: the line through every point, the area under it, a dot on
 * each point with its value in a tooltip, and the first and last year below.
 * On entry the area fades in and the line draws itself; with reduced motion
 * both are drawn at once. No points, nothing drawn but the note.
 */
export function AreaSpark({ points, label, unit = 'commits' }: { points: readonly AreaPoint[]; label: string; unit?: string }) {
  const reduce = useReducedMotion();
  if (points.length === 0) return <p className="text-xs text-muted">No values to draw.</p>;
  const { coords, line, area } = areaGeometry(points, WIDTH, HEIGHT);
  const text = points.map((p) => `${p.label}: ${formatNumber(p.value)}`).join(', ');
  const transition = { duration: DURATION.view * 2, ease: EASE };
  return (
    <svg role="img" aria-label={`${label}: ${text}`} data-xv-area={points.length} className="block h-auto w-full overflow-visible" viewBox={`0 ${-PAD_TOP} ${WIDTH} ${HEIGHT + PAD_TOP + LABELS}`}>
      <line x1={0} y1={HEIGHT} x2={WIDTH} y2={HEIGHT} className="stroke-line-2" strokeWidth={1} />
      <motion.path d={area} data-xv-area-fill="" style={{ fill: 'rgb(106 77 255 / 0.14)' }} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={transition} />
      <motion.path d={line} data-xv-area-line="" fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: 'var(--color-accent)' }} initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={transition} />
      {coords.map(([x, y], i) => (
        <circle key={points[i].label} cx={x} cy={y} r={2.5} className="fill-surface" strokeWidth={1.5} style={{ stroke: 'var(--color-accent)' }}>
          <title>{`${points[i].label}: ${formatNumber(points[i].value)} ${unit}`}</title>
        </circle>
      ))}
      <text x={coords[0][0]} y={HEIGHT + 13} textAnchor={points.length === 1 ? 'middle' : 'start'} className="fill-muted text-[10px]">{points[0].label}</text>
      {points.length > 1 ? <text x={coords[coords.length - 1][0]} y={HEIGHT + 13} textAnchor="end" className="fill-muted text-[10px]">{points[points.length - 1].label}</text> : null}
    </svg>
  );
}
