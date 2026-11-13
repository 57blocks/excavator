import type { Group } from '../lib/groups';
import { groupByOther, handedOver, received } from '../lib/handovers';
import type { Indexed } from '../lib/handovers';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { hrefOf } from '../lib/pages';
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

interface Props { group: Group; colour: Pair; mapLabel: string; previous?: Group; next?: Group }

/**
 * A domain page: the breadcrumbs, the name with its colour mark, the intro as the lead, the two columns of hand-overs and the
 * domain's own section of the domains chapter. Without a usable list it holds the features of the group as links.
 */
export function DomainPage({ group, colour, mapLabel, previous, next }: Props) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const model = useModel();
  const domain = model.domains[group.id];
  const intro = domain?.intro[view] ?? '';
  const body = domain?.body[view] ?? '';
  return (
    <div className="wrap domain" data-view="domain" data-domain={group.id} {...colourProps(colour)}>
      <Breadcrumbs trail={[{ label: mapLabel, href: nav.home }, { label: group.name }]} />
      <h1 className="page-title dom-title"><Mark colour={colour} />{group.name}</h1>
      {intro !== '' && <p className="lede dom-lede"><InlineMarkdown source={intro} /></p>}
      {model.map ? (
        <>
          <div className="dom-cols">
            <Column kind="in" list={received(model.handovers, group.id)} side="from" />
            <Column kind="out" list={handedOver(model.handovers, group.id)} side="to" />
          </div>
          {body !== '' && <div className="dom-body"><Markdown source={body} idPrefix={`domain-${group.id}`} /></div>}
        </>
      ) : (
        <>
          <h2>{t('page.domain.features')}</h2>
          <ul className="plain-list">
            {group.features.map((item) => <li key={item.key}><a href={hrefOf(item, nav)}>{item.title}</a></li>)}
          </ul>
        </>
      )}
      {(previous !== undefined || next !== undefined) && (
        <nav className="chap-nav" aria-label={t('page.domain.nav')} data-part="domain-nav">
          {previous !== undefined && <a rel="prev" data-side="previous" href={nav.domain(previous.id)}><small>{t('page.domain.previous')}</small>{previous.name}</a>}
          {next !== undefined && <a rel="next" data-side="next" href={nav.domain(next.id)}><small>{t('page.domain.next')}</small>{next.name}</a>}
        </nav>
      )}
    </div>
  );
}
