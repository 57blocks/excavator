import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

import { DURATION, EASE } from '../../lib/motion';
import { formatNumber } from '../../lib/format';

/** A number that rolls from 0 to its value; the value is the text from the first frame when reduced motion is requested. */
export function RollingNumber({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const shown = useMotionValue(reduce ? value : 0);
  const text = useTransform(shown, (v) => formatNumber(v));
  useEffect(() => {
    if (reduce) {
      shown.set(value);
      return undefined;
    }
    const controls = animate(shown, value, { duration: DURATION.count, ease: EASE });
    return () => controls.stop();
  }, [value, reduce, shown]);
  return <motion.span>{text}</motion.span>;
}

/** A count tile: a label over a value; a value that is a finite number rolls up to it. */
export function Tile({ label, value }: { label: ReactNode; value: unknown }) {
  return (
    <div className="min-w-0 rounded-control border border-line-2 px-3.5 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-[22px] font-semibold text-ink [overflow-wrap:anywhere]">
        {typeof value === 'number' && Number.isFinite(value) ? <RollingNumber value={Math.round(value)} /> : formatNumber(value)}
      </div>
    </div>
  );
}

export function Tiles({ children }: { children?: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">{children}</div>;
}
