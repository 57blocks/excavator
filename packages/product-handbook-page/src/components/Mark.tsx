import { colourProps } from '../lib/strata';
import type { Pair } from '../lib/strata';

/** The small square of a domain's colour; decorative, the name always stands next to it. */
export function Mark({ colour }: { colour: Pair }) {
  return <span className="mark" aria-hidden="true" {...colourProps(colour)} />;
}
