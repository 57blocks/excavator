import type { Group } from '../lib/groups';
import { useLinks } from '../lib/links';
import { useModel } from '../lib/model';
import { highestLevels, levelText } from '../lib/problems';
import { colourProps } from '../lib/strata';
import { useText } from '../lib/text';
import { Mark } from './Mark';

/** The separator of the two parts of a level mark: a middle dot, written as a code so the source stays plain ASCII. */
const DOT = ` ${String.fromCharCode(0xb7)} `;

/**
 * The grid of the overview: one block per group (its mark, its name as a link to its page, its feature count), and in each block
 * every feature as a link with its title on one line, the level mark of its worst problems (when it has any) and its problem count.
 */
export function OverviewGrid({ groups }: { groups: Group[] }) {
  const t = useText();
  const nav = useLinks();
  const { colours, problems, problemCount } = useModel();
  return (
    <div className="ov-grid" data-part="overview-grid">
      {groups.map((group) => (
          <section key={group.id} className="ov-block" data-group={group.id} {...colourProps(colours[group.id])}>
            <h2 className="ov-head">
              <Mark colour={colours[group.id]} />
              <a href={nav.domain(group.id)}>{group.name}</a>
              <small>{group.features.length}</small>
            </h2>
            <ul>
              {group.features.map((item) => {
                const levels = highestLevels(problems.rows, item.block);
                const mark = [levels.defect, levels.design].flatMap((level) => (level === null ? [] : [levelText(t, level)])).join(DOT);
                return (
                  <li key={item.block}>
                    <a href={nav.chapter(item.block)} data-feature={item.block}>
                      <span className="ov-title" title={item.title}>{item.title}</span>
                      {mark !== '' && <span className="ov-level" data-part="level-mark">{mark}</span>}
                      <span className="ov-count" data-part="problem-count">{problemCount[item.block] ?? 0}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
      ))}
    </div>
  );
}
