import { useText } from '../lib/text';
import { consequenceKey } from '../lib/types';
import type { Priority } from '../lib/types';

/** The level of a group of findings as a small badge, with the consequence's name as its tooltip; the word for none when the group has no priority. */
export function PriorityBadge({ priority }: { priority: Priority | null }) {
  const t = useText();
  if (priority === null) return <span className="priority-badge" data-level="none">{t('md.priority.unranked')}</span>;
  return <span className="priority-badge" data-level={priority.level} title={t(consequenceKey(priority.consequence))}>{t('md.priority.level', { rank: priority.level.slice(1) })}</span>;
}
