import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import type { Text } from '../lib/text';
import type { PageData } from '../lib/types';
import { Cell, TableScroll } from './Tables';

/** The ui key of the name of a section of the sources part (`system-findings` is `systemFindings`). */
const sectionKey = (id: string): string => `md.appendix.section.${id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`;

/** Feature names as links to their pages, joined with commas. */
function FeatureLinks({ data, ids }: { data: PageData; ids: string[] }) {
  const nav = useLinks();
  const name = (id: string): string => data.features.find((feature) => feature.id === id)?.name ?? id;
  return <>{ids.map((id, at) => <span key={id}>{at > 0 && ', '}<a href={nav.feature(id)}>{name(id)}</a></span>)}</>;
}

function Head({ data, title }: { data: PageData; title: string }) {
  return (
    <header className="page-head">
      <p className="eyebrow">{data.project}</p>
      <h1 className="page-title">{title}</h1>
    </header>
  );
}

/**
 * The open questions (first part of the appendix): the unknowns of the verified entries and of the verified system overview, each in its own
 * words with the places searched, grouped by domain (the overview's first). Nothing is written that an entry does not say.
 */
export function OpenQuestionsPage({ data }: { data: PageData }) {
  const t = useText();
  const { open } = data.appendix;
  const groups = [{ id: null as string | null, name: t('md.overview.heading') }, ...data.domains];
  return (
    <article className="page" data-view="open-questions">
      <Head data={data} title={t('md.appendix.openHeading')} />
      <p className="muted summary-note">{t('md.appendix.openNote')}</p>
      <p className="summary-counts">{t('md.appendix.openCount', { count: open.length })}</p>
      {open.length === 0 && <p className="muted" data-part="open-none">{t('md.none')}</p>}
      {groups.map((group) => {
        const rows = open.filter((row) => row.domain === group.id);
        if (rows.length === 0) return null;
        return (
          <section className="section" key={group.id ?? 'overview'} data-domain={group.id ?? 'overview'}>
            <h2 className="section-title">{group.name}</h2>
            <TableScroll label={group.name} wide>
              <thead>
                <tr><th scope="col">{t('md.table.feature')}</th><th scope="col">{t('md.appendix.table.question')}</th><th scope="col">{t('md.appendix.table.searched')}</th></tr>
              </thead>
              <tbody>
                {rows.map((row, at) => (
                  <tr key={at}>
                    <td data-empty={row.feature === null ? 'true' : undefined}>{row.feature !== null && <FeatureLinks data={data} ids={[row.feature]} />}</td>
                    <Cell>{row.item}</Cell>
                    <Cell>{row.searched}</Cell>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          </section>
        );
      })}
    </article>
  );
}

/** The glossary: each term once as the verified entries write it, its kinds, each meaning with its features and the features it occurs in. */
export function GlossaryPage({ data }: { data: PageData }) {
  const t = useText();
  const { glossary } = data.appendix;
  return (
    <article className="page" data-view="glossary">
      <Head data={data} title={t('md.appendix.glossaryHeading')} />
      <p className="muted summary-note">{t('md.appendix.glossaryNote')}</p>
      <p className="summary-counts">{t('md.appendix.glossaryCount', { count: glossary.length })}</p>
      {glossary.length === 0 ? <p className="muted" data-part="glossary-none">{t('md.none')}</p> : (
        <TableScroll label={t('md.appendix.glossaryHeading')} wide>
          <thead>
            <tr><th scope="col">{t('md.appendix.table.term')}</th><th scope="col">{t('md.appendix.table.kind')}</th><th scope="col">{t('md.table.meaning')}</th><th scope="col">{t('md.table.features')}</th></tr>
          </thead>
          <tbody>
            {glossary.map((row, at) => (
              <tr key={at} data-term={row.term}>
                <Cell row>{row.term}</Cell>
                <Cell>{row.kinds.map((kind) => t(`md.appendix.kind.${kind}`)).join(', ')}</Cell>
                <td data-empty={row.meanings.length === 0 ? 'true' : undefined}>
                  {row.meanings.length > 0 && (
                    <ul className="rule-list">
                      {row.meanings.map((meaning, index) => <li key={index}>{t('md.appendix.meaningItem', { meaning: meaning.text, features: meaning.features.map((id) => data.features.find((feature) => feature.id === id)?.name ?? id).join(', ') })}</li>)}
                    </ul>
                  )}
                </td>
                <td><FeatureLinks data={data} ids={row.features} /></td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </article>
  );
}

function PartsTable({ data, t }: { data: PageData; t: Text }) {
  const { parts } = data.appendix.sources;
  return (
    <TableScroll label={t('md.appendix.sourcesHeading')} wide>
      <thead>
        <tr>
          <th scope="col">{t('md.appendix.table.section')}</th><th scope="col">{t('md.appendix.table.units')}</th><th scope="col">{t('md.appendix.table.verifiedUnits')}</th><th scope="col">{t('md.appendix.table.items')}</th>
          <th scope="col">{t('md.appendix.table.removedVerify')}</th><th scope="col">{t('md.appendix.table.removedTrace')}</th><th scope="col">{t('md.appendix.table.again')}</th>
        </tr>
      </thead>
      <tbody>
        {parts.map((row) => (
          <tr key={row.id} data-section={row.id}>
            <Cell row>{t(sectionKey(row.id))}</Cell>
            <Cell>{String(row.units)}</Cell><Cell>{String(row.verified)}</Cell><Cell>{String(row.items)}</Cell>
            <Cell>{String(row.removedVerify)}</Cell><Cell>{String(row.removedTrace)}</Cell><Cell>{String(row.again)}</Cell>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
}

/** The sources and scope: what the handbook was written from and not, the checks every fact passed, the counts of each section and what the judges kept and left out. */
export function SourcesPage({ data }: { data: PageData }) {
  const t = useText();
  const { ranked } = data.appendix.sources;
  return (
    <article className="page" data-view="sources">
      <Head data={data} title={t('md.appendix.sourcesHeading')} />
      <p>{t('md.appendix.read')}</p>
      <p>{t('md.appendix.notRead')}</p>
      <p>{t('md.appendix.checks')}</p>
      <p className="muted summary-note">{t('md.appendix.sectionsNote')}</p>
      <PartsTable data={data} t={t} />
      <p className="muted summary-note">{t('md.appendix.rankedNote')}</p>
      <TableScroll label={t('md.appendix.rankedNote')} wide>
        <thead>
          <tr><th scope="col">{t('md.appendix.table.part')}</th><th scope="col">{t('md.appendix.table.kept')}</th><th scope="col">{t('md.appendix.table.leftOut')}</th></tr>
        </thead>
        <tbody>
          {(['priority', 'remedies', 'topics'] as const).map((id) => (
            <tr key={id} data-part={id}><Cell row>{t(`md.appendix.ranked.${id}`)}</Cell><Cell>{String(ranked[id].kept)}</Cell><Cell>{String(ranked[id].left)}</Cell></tr>
          ))}
        </tbody>
      </TableScroll>
    </article>
  );
}
