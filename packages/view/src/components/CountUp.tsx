// A number that rolls up from zero when it first appears (motion inventory,
// task 10.1). The final value is in data-value and the accessible label from
// the start; under reduced motion the final value is shown at once.
import { useEffect, useState } from 'react';
import { fmtNumber } from '../format';
import { useReducedMotion } from '../motion';

const DURATION_MS = 700;

export function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced || value === 0) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION_MS);
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return (
    <span className="count-up" data-motion="counter" data-motion-state={reduced ? 'static' : 'animated'} data-value={value} aria-label={fmtNumber(value)}>
      {fmtNumber(shown)}
    </span>
  );
}
