import { useModel } from '../lib/model';
import { emphasised } from '../lib/rich';
import { PROBLEM_TYPES, countRows } from '../lib/problems';
import { useText } from '../lib/text';
import type { Group } from '../lib/groups';
import type { ProblemType } from '../lib/types';

const SOURCE_OF = { defect: 'defects', design: 'design', open: 'open' } as const;

/** The number of distinct feature chapters in the groups. */
export const featureCount = (groups: readonly Group[]): number => new Set(groups.flatMap((group) => group.features.map((item) => item.block))).size;

/**
 * The counts line under the lead: the domains (with a map), the features and the total of each problem type. A source that is
 * not usable shows its state in words instead of a number; open questions with an unmatched chapter carry the incomplete marker.
 */
export function OverviewCounts({ groups }: { groups: Group[] }) {
  const t = useText();
  const model = useModel();
  const { sources, rows } = model.problems;
  const total = (type: ProblemType): { text: string | null; total: number } => {
    const source = sources[SOURCE_OF[type]];
    if (source.state !== 'ok') return { text: t(`page.problems.count.${source.state}`), total: 0 };
    const incomplete = type === 'open' && sources.open.unmatched.length > 0;
    return { text: incomplete ? t('page.problems.count.incomplete') : null, total: countRows(rows, type).total };
  };
  return (
    <ul className="ov-counts" data-part="overview-counts">
      {model.map && <li data-count="domains">{emphasised(t('page.overview.domains', { count: '{count}' }), { count: groups.length })}</li>}
      <li data-count="features">{emphasised(t('page.overview.features', { count: '{count}' }), { count: featureCount(groups) })}</li>
      {PROBLEM_TYPES.map((type) => {
        const shown = total(type);
        const usable = sources[SOURCE_OF[type]].state === 'ok';
        return (
          <li key={type} data-count={type} data-state={sources[SOURCE_OF[type]].state}>
            {t(`page.problems.type.${type}`)}{' '}
            {usable ? <><strong>{shown.total}</strong>{shown.text !== null && ` ${shown.text}`}</> : shown.text}
          </li>
        );
      })}
    </ul>
  );
}
