import { mentioning } from '../lib/handovers';
import { useModel } from '../lib/model';
import { useText } from '../lib/text';
import { DomainLink } from './Flows';
import { HandoverText } from './HandoverText';

/**
 * The hand-overs with other domains that name a feature chapter, under the chapter's head: handed over or received, from the
 * point of view of the chapter's domain (or "from to" when the chapter's domain is neither end). A strip between rules, not a
 * box, and it holds no heading element: the headings of the article are numbered from its text alone.
 */
export function HandoverStrip({ chapter }: { chapter: string }) {
  const t = useText();
  const { handovers, chapterDomain, map } = useModel();
  if (!map) return null;
  const list = mentioning(handovers, chapter);
  if (list.length === 0) return null;
  const home = chapterDomain[chapter];
  return (
    <section className="strip" aria-label={t('page.strip.heading')} data-part="handover-strip">
      <p className="strip-title">{t('page.strip.heading')}</p>
      <ul>
        {list.map((handover, at) => {
          const out = handover.from === home;
          const into = handover.to === home;
          return (
            <li key={at} className={out ? 'dir-out' : into ? 'dir-in' : undefined} data-direction={out ? 'out' : into ? 'in' : 'between'}>
              <span className="strip-dir">
                {out && <>{t('page.handover.out')} <DomainLink id={handover.to} /></>}
                {into && <>{t('page.handover.in')} <DomainLink id={handover.from} /></>}
                {!out && !into && <><DomainLink id={handover.from} /> {t('page.handover.between')} <DomainLink id={handover.to} /></>}
              </span>
              <span className="strip-text"><HandoverText handover={handover} /></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
