import { useProblems } from '../lib/chunks';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { levelText } from '../lib/problems';
import { useText } from '../lib/text';
import type { ProblemRow, ProcessItem } from '../lib/types';
import { Breadcrumbs } from './Breadcrumbs';
import { ChunkNotice } from './ChunkNotice';
import { InlineMarkdown } from './InlineMarkdown';
import { Cites, ProblemBody } from './ProblemsPage';
import { RemedyItem } from './RemedyItem';

/** A feature as a link to its page, by its chapter title (its id when the title is unknown). */
function FeatureLink({ id }: { id: string }) {
  const nav = useLinks();
  const { titles } = useModel();
  return <a href={nav.chapter(id)} data-feature={id}>{titles[id] ?? id}</a>;
}

/** The design problems that name this process, each with its title, impact, situation, consequence and (technical view) citations. */
function ProcessProblems({ rows, id }: { rows: ProblemRow[]; id: string }) {
  const t = useText();
  const detail = useProblems(rows);
  const mine = (detail.status === 'ready' ? detail.value : rows).filter((row) => row.type === 'design' && row.process === id);
  if (mine.length === 0) return null;
  return (
    <section className="proc-problems" data-part="process-problems">
      <h2>{t('page.processes.problems')}</h2>
      {detail.status !== 'ready' && <ChunkNotice state={detail} />}
      <ul className="proc-rows">
        {mine.map((row) => (
          <li key={row.id} data-problem={row.id} data-level={row.level ?? undefined}>
            <div className="proc-row-head">
              <b className="proc-row-title">{row.summary}</b>
              {row.level !== null && <span className="prob-level" data-level={row.level}>{levelText(t, row.level)}</span>}
            </div>
            {detail.status === 'ready' && <ProblemBody row={row} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The improvement suggestions written under this process, in chapter order, each in plain text with a line for each problem it names. */
function ProcessSuggestions({ item }: { item: ProcessItem }) {
  const t = useText();
  const view = useView();
  const shown = (item.remedies ?? []).flatMap((remedy) => (remedy.texts[view] === undefined ? [] : [{ line: remedy.line, text: remedy.texts[view] as string }]));
  if (shown.length === 0) return null;
  return (
    <section className="proc-remedies" data-part="process-remedies">
      <h2>{t('page.processes.suggestions')}</h2>
      <ul className="proc-rows">
        {shown.map((remedy) => (
          <li key={remedy.line} data-remedy-line={remedy.line}>
            <RemedyItem text={remedy.text} line={remedy.line} idPrefix={`process-${item.id}-remedy-${remedy.line}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One process: its domain, its steps in order (who, the operation, the feature as a link, the sentence, the citations in the technical view), its end state, its problems and suggestions and the features it passes through. The reader never sees its number. */
function ProcessDetail({ item, rows }: { item: ProcessItem; rows: ProblemRow[] }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const { domains } = useModel();
  const domain = item.domain === undefined ? undefined : domains[item.domain];
  const cited = (cites: string[] | undefined) => (view === 'technical' && cites !== undefined && cites.length > 0 ? <Cites cites={cites} /> : null);
  return (
    <div className="wrap processes" data-view="process" data-chapter="processes" data-process={item.id}>
      <Breadcrumbs trail={[{ label: t('page.nav.overview'), href: nav.home }, { label: item.name }]} />
      {domain !== undefined && <p className="proc-domain-line" data-part="process-domain"><a href={nav.domain(domain.id)}>{domain.name}</a></p>}
      <h1 className="page-title">{item.name}</h1>
      <ol className="proc-steps" data-part="process-steps">
        {item.steps.map((step, at) => (
          <li key={at} data-feature={step.feature}>
            <div className="proc-step-head">
              <span className="proc-role">{step.role}</span>
              <b className="proc-op">{step.operation}</b>
              <FeatureLink id={step.feature} />
            </div>
            <p className="proc-text"><InlineMarkdown source={step.text} links={false} /></p>
            {cited(step.cites)}
          </li>
        ))}
      </ol>
      {item.end !== undefined && (
        <p className="proc-end" data-part="process-end"><b>{t('chapter.processes.end')}</b> <InlineMarkdown source={item.end.text} links={false} />{cited(item.end.cites)}</p>
      )}
      <ProcessProblems rows={rows} id={item.id} />
      <ProcessSuggestions item={item} />
      <section className="proc-features" data-part="process-features">
        <h2>{t('page.processes.features')}</h2>
        <ul>{item.features.map((id) => <li key={id}><FeatureLink id={id} /></li>)}</ul>
      </section>
    </div>
  );
}

/** The route `#/processes/P<n>`: one process. The caller has checked that the process exists. */
export function ProcessesPage({ id }: { id: string }) {
  const { processes, problems } = useModel();
  const item = processes?.items.find((entry) => entry.id === id);
  return item === undefined ? null : <ProcessDetail item={item} rows={problems.rows} />;
}
