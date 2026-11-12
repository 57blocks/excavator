import type { ReactNode } from 'react';

/** A page section's heading: a serif h2 the "On this page" outline lists (`data-outline`), with the id its target needs. */
export function SectionHeading({ id, label, name }: { id: string; label: ReactNode; name: string }) {
  return <h2 className="section" id={`section-${id}`} data-section={id} data-outline="section" data-outline-label={name}>{label}</h2>;
}

