import type { ReactNode } from 'react';

export function Badge({ state, children }: { state: string; children: ReactNode }) {
  return (
    <span className="badge" data-state={state}>
      {children}
    </span>
  );
}
