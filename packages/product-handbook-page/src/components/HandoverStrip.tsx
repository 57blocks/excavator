import { mentioning } from '../lib/handovers';
import { useModel } from '../lib/model';
import { useText } from '../lib/text';
import { DomainLink } from './Flows';
import { HandoverText } from './HandoverText';
import type { HandoverData } from '../lib/types';

/** The links the strip of a chapter lists (none without a map): the page shows its hint line only when there are some. */
export function stripRows(model: Pick<ReturnType<typeof useModel>, 'handovers' | 'map'>, chapter: string) {
  return model.map ? mentioning(model.handovers, chapter) : [];
}

type Direction = 'in' | 'out' | 'between';

/**
 * The hand-overs with other domains that name a feature chapter, in the last block of the chapter's page, from the point of view of
 * the chapter's domain: received (upstream) and handed over (downstream) in two columns, each with its count of hand-overs, then every
 * domain at the other end once with the words of each of its hand-overs; a column with none says so. A hand-over neither end of which is the chapter's domain is listed
 * under the columns as "from to". No box, no rules, and no heading element: the headings of the article are numbered from its text alone.
 */
export function HandoverStrip({ chapter }: { chapter: string }) {
  const t = useText();
  const model = useModel();
  const list = stripRows(model, chapter);
  if (list.length === 0) return null;
  const home = model.chapterDomain[chapter];
  const rows = list.map((handover) => ({ handover, dir: (handover.from === home ? 'out' : handover.to === home ? 'in' : 'between') as Direction }));
  const between = ({ handover, dir }: { handover: HandoverData; dir: Direction }, at: number) => (
    <li key={at} data-direction={dir}>
      <span className="strip-dir"><DomainLink id={handover.from} /> {t('page.handover.between')} <DomainLink id={handover.to} /></span>
      <span className="strip-text"><HandoverText handover={handover} /></span>
    </li>
  );
  /** One row per domain at the other end, in the order of its first hand-over, with the words of each of its hand-overs. */
  const byDomain = (dir: 'in' | 'out', own: { handover: HandoverData }[]) => {
    const groups = new Map<string, HandoverData[]>();
    for (const { handover } of own) {
      const other = dir === 'in' ? handover.from : handover.to;
      groups.set(other, [...(groups.get(other) ?? []), handover]);
    }
    return Array.from(groups, ([other, list]) => (
      <li key={other} className={`dir-${dir}`} data-direction={dir}>
        <span className="strip-dir"><DomainLink id={other} /></span>
        {list.map((handover, at) => <span key={at} className="strip-text"><HandoverText handover={handover} /></span>)}
      </li>
    ));
  };
  const column = (dir: 'in' | 'out') => {
    const own = rows.filter((row) => row.dir === dir);
    return (
      <div className={`strip-col dir-${dir}`} data-column={dir}>
        <p className="strip-col-title"><span className="strip-col-name">{t(dir === 'in' ? 'page.handover.in' : 'page.handover.out')}</span>{own.length > 0 && <span className="strip-n">{own.length}</span>}</p>
        {own.length === 0 ? <p className="muted">{t(dir === 'in' ? 'page.domain.noneIn' : 'page.domain.noneOut')}</p> : <ul>{byDomain(dir, own)}</ul>}
      </div>
    );
  };
  const others = rows.filter((row) => row.dir === 'between');
  return (
    <section className="strip" aria-label={t('page.strip.heading')} data-part="handover-strip">
      <p className="strip-title">{t('page.strip.heading')}</p>
      <div className="strip-cols">{column('in')}{column('out')}</div>
      {others.length > 0 && <ul className="strip-between">{others.map(between)}</ul>}
    </section>
  );
}
