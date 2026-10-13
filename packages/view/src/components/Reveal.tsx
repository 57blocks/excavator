// A block that fades and rises into place the first time it scrolls into
// view (motion inventory, task 10.1); `order` staggers neighbors by 60 ms.
// Under reduced motion it is simply shown.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../motion';

export function Reveal({ children, order = 0 }: { children: ReactNode; order?: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(reduced);
  useEffect(() => {
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setShown(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced]);
  return (
    <div
      ref={ref}
      className={`reveal${shown ? ' in' : ''}`}
      style={reduced ? undefined : { transitionDelay: `${Math.min(order, 8) * 60}ms` }}
      data-motion="reveal"
      data-motion-state={reduced ? 'static' : 'animated'}
    >
      {children}
    </div>
  );
}
