import { useText } from '../lib/text';
import type { Reach } from '../lib/types';

/** How readers get to a feature, as a small coloured badge with the reach's name. */
export function ReachBadge({ reach }: { reach: Reach }) {
  const t = useText();
  return <span className="reach-badge" data-reach={reach}>{t(`md.reach.${reach}`)}</span>;
}

/** The sidebar's mark: a dot whose colour is the reach's, with the name as hidden text and as a tooltip. */
export function ReachDot({ reach }: { reach: Reach }) {
  const t = useText();
  const name = t(`md.reach.${reach}`);
  return (
    <span className="reach-dot" data-reach={reach} title={name}>
      <span className="sr-only">{name}</span>
    </span>
  );
}
