import { useText } from '../lib/text';
import type { Reach } from '../lib/types';

/** How readers get to a feature, as a small coloured badge with the reach's name. */
export function ReachBadge({ reach }: { reach: Reach }) {
  const t = useText();
  return <span className="reach-badge" data-reach={reach}>{t(`md.reach.${reach}`)}</span>;
}
