import type { Group } from '../lib/groups';
import { groupByOther, handedOver, received } from '../lib/handovers';
import type { Indexed } from '../lib/handovers';
import { withoutHandoverList } from '../lib/domain-body';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { highestLevels, levelText } from '../lib/problems';
import type { Pair } from '../lib/strata';
import { colourProps } from '../lib/strata';
import { useText } from '../lib/text';
import { Breadcrumbs } from './Breadcrumbs';
import { DomainLink } from './Flows';
import { HandoverText } from './HandoverText';
import { InlineMarkdown } from './InlineMarkdown';
import { Mark } from './Mark';
import { Markdown } from './Markdown';

/** One column of a domain page: a heading with the number of hand-overs, then the hand-overs grouped by the domain at the other end. */
function Column({ kind, list, side }: { kind: 'in' | 'out'; list: Indexed[]; side: 'from' | 'to' }) {
  const t = useText();
  return (
    <section className={`dom-col dir-${kind}`} data-column={kind}>
      <h2>{t(kind === 'in' ? 'page.handover.in' : 'page.handover.out')}<small>{list.length}</small></h2>
      {list.length === 0 ? <p className="empty">{t(kind === 'in' ? 'page.domain.noneIn' : 'page.domain.noneOut')}</p> : (
        <ul>
          {groupByOther(list, side).map((group) => (
            <li key={group.other} data-other={group.other}>
              <b><DomainLink id={group.other} /></b>
              {group.items.map((entry) => <div key={entry.index} className="ho"><HandoverText handover={entry.handover} /></div>)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The separator of the two parts of a level mark: a middle dot, written as a code so the source stays plain ASCII. */
const DOT = ` ${String.fromCharCode(0xb7)} `;

/** Every feature of the group as a link to its page: its title, the level mark of its worst problems (when it has any) and its problem count (0 shown). */
function Features({ group }: { group: Group }) {
  const t = useText();
  const nav = useLinks();
  const { problems, problemCount } = useModel();
  return (
    <section className="dom-features" data-part="domain-features">
      <h2>{t('page.domain.features')}</h2>
      <ul>
        {group.features.map((item) => {
          const levels = highestLevels(problems.rows, item.block);
          const mark = [levels.defect, levels.design].flatMap((level) => (level === null ? [] : [levelText(t, level)])).join(DOT);
          return (
            <li key={item.block}>
              <a href={nav.chapter(item.block)} data-feature={item.block}>
                <span className="feat-title" title={item.title}>{item.title}</span>
                {mark !== '' && <span className="feat-level" data-part="level-mark">{mark}</span>}
                <span className="feat-count" data-part="problem-count">{problemCount[item.block] ?? 0}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface Props { group: Group; colour: Pair; mapLabel: string; previous?: Group; next?: Group }

/**
 * A domain page, inside the frame with the domain list at the left: the breadcrumbs, the name with its colour mark and the
 * intro as the lead. With a usable list of links the domain's own section of the domains chapter follows (its features table
 * and main line, without the hand-over list, which the two columns replace), then the two columns of hand-overs; without one,
 * every feature of the domain as a link with its worst level and its problem count stands in for the section. Last come the
 * previous and the next domain.
 */
export function DomainPage({ group, colour, mapLabel, previous, next }: Props) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const model = useModel();
  const domain = model.domains[group.id];
  const intro = domain?.intro[view] ?? '';
  const shown = withoutHandoverList(domain?.body[view] ?? '').trim();
  return (
    <div className="wrap domain" data-view="domain" data-domain={group.id} {...colourProps(colour)}>
      <Breadcrumbs trail={[{ label: mapLabel, href: nav.home }, { label: group.name }]} />
      <h1 className="page-title dom-title"><Mark colour={colour} />{group.name}</h1>
      {intro !== '' && <p className="lede dom-lede"><InlineMarkdown source={intro} /></p>}
      {model.map ? (
        <>
          {shown !== '' && <div className="dom-body"><Markdown source={shown} idPrefix={`domain-${group.id}`} /></div>}
          <div className="dom-cols">
            <Column kind="in" list={received(model.handovers, group.id)} side="from" />
            <Column kind="out" list={handedOver(model.handovers, group.id)} side="to" />
          </div>
        </>
      ) : <Features group={group} />}
      {(previous !== undefined || next !== undefined) && (
        <nav className="chap-nav" aria-label={t('page.domain.nav')} data-part="domain-nav">
          {previous !== undefined && <a rel="prev" data-side="previous" href={nav.domain(previous.id)}><small>{t('page.domain.previous')}</small>{previous.name}</a>}
          {next !== undefined && <a rel="next" data-side="next" href={nav.domain(next.id)}><small>{t('page.domain.next')}</small>{next.name}</a>}
        </nav>
      )}
    </div>
  );
}
