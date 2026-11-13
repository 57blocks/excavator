import { handedOver, received } from '../lib/handovers';
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

/** The lists of a domain's hand-overs: handed over (blue heading), then received (ochre heading); each item is the other domain and the words. */
export function Flows({ id }: { id: string }) {
  const t = useText();
  const { handovers } = useModel();
  const outs = handedOver(handovers, id);
  const ins = received(handovers, id);
  const item = (entry: Indexed, other: string) => <li key={entry.index} data-handover={entry.index}><b><DomainLink id={other} /></b><HandoverText handover={entry.handover} /></li>;
  if (outs.length === 0 && ins.length === 0) return <p className="flow-none">{t('page.flow.none')}</p>;
  return (
    <div className="flows">
      {outs.length > 0 && <><h4 className="dir-out">{t('page.flow.out', { count: outs.length })}</h4><ul className="flow-list">{outs.map((entry) => item(entry, entry.handover.to))}</ul></>}
      {ins.length > 0 && <><h4 className="dir-in">{t('page.flow.in', { count: ins.length })}</h4><ul className="flow-list">{ins.map((entry) => item(entry, entry.handover.from))}</ul></>}
    </div>
  );
}
