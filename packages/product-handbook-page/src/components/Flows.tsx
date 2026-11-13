import { groupByOther, handedOver, received } from '../lib/handovers';
import type { Indexed } from '../lib/handovers';
import { useLinks } from '../lib/links';
import { useModel } from '../lib/model';
import { useText } from '../lib/text';
import { HandoverText } from './HandoverText';
import { Mark } from './Mark';

/** A domain as a mark and a link to its page. */
export function DomainLink({ id }: { id: string }) {
  const nav = useLinks();
  const { colours, domains } = useModel();
  return <span className="dom-ref"><Mark colour={colours[id]} /><a href={nav.domain(id)}>{domains[id]?.name ?? id}</a></span>;
}

/** The lists of a domain's hand-overs: handed over (blue heading), then received (ochre heading); each item is a domain at the other end with the words of every hand-over with it. */
export function Flows({ id }: { id: string }) {
  const t = useText();
  const { handovers } = useModel();
  const outs = handedOver(handovers, id);
  const ins = received(handovers, id);
  const list = (entries: Indexed[], side: 'from' | 'to') => (
    <ul className="flow-list">
      {groupByOther(entries, side).map((group) => (
        <li key={group.other} data-other={group.other}>
          <b><DomainLink id={group.other} /></b>
          {group.items.map((entry) => <div key={entry.index} className="ho" data-handover={entry.index}><HandoverText handover={entry.handover} /></div>)}
        </li>
      ))}
    </ul>
  );
  if (outs.length === 0 && ins.length === 0) return <p className="flow-none">{t('page.flow.none')}</p>;
  return (
    <div className="flows">
      {outs.length > 0 && <><h4 className="dir-out">{t('page.flow.out', { count: outs.length })}</h4>{list(outs, 'to')}</>}
      {ins.length > 0 && <><h4 className="dir-in">{t('page.flow.in', { count: ins.length })}</h4>{list(ins, 'from')}</>}
    </div>
  );
}
