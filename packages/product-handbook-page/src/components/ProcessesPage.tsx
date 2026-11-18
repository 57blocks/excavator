import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { useText } from '../lib/text';
import type { ProblemRow, ProcessItem, ProcessesData } from '../lib/types';
import { Breadcrumbs } from './Breadcrumbs';
import { InlineMarkdown } from './InlineMarkdown';
import { Cites } from './ProblemsPage';

/** A feature as a link to its page, by its chapter title (its id when the title is unknown). */
function FeatureLink({ id }: { id: string }) {
  const nav = useLinks();
  const { titles } = useModel();
  return <a href={nav.chapter(id)} data-feature={id}>{titles[id] ?? id}</a>;
}

/** The operations of each feature that no step of any process names, under the heading the chapter's generated section has (its jump target is the heading number the search index gives it). */
function Coverage({ processes }: { processes: ProcessesData }) {
  const t = useText();
  return (
    <section className="proc-coverage" data-part="process-coverage">
      <h2 id={`h-${processes.items.length}`} tabIndex={-1}>{t('chapter.processes.uncovered')}</h2>
      {processes.coverage.length === 0 ? <p className="muted">{t('chapter.processes.uncoveredNone')}</p> : (
        <ul>
          {processes.coverage.map((gap) => (
            <li key={gap.feature} data-feature={gap.feature}><FeatureLink id={gap.feature} />{`${t('page.processes.colon')} ${gap.operations.join(t('chapter.processes.uncoveredJoin'))}`}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The business processes page: every process with its number, its name and its step count, then the operations in no process. */
function ProcessList({ processes }: { processes: ProcessesData }) {
  const t = useText();
  const nav = useLinks();
  return (
    <div className="wrap processes" data-view="processes" data-chapter="processes">
      <Breadcrumbs trail={[{ label: t('page.nav.overview'), href: nav.home }, { label: t('page.nav.processes') }]} />
      <h1 className="page-title">{t('page.nav.processes')}</h1>
      <ol className="proc-list" data-part="process-list" aria-label={t('page.nav.processes')}>
        {processes.items.map((item) => (
          <li key={item.id} data-process={item.id}>
            <a href={nav.process(item.id)}>
              <span className="proc-no">{item.id}</span>
              <span className="proc-name">{item.name}</span>
              <span className="proc-count">{t('page.processes.stepCount', { count: item.steps.length })}</span>
            </a>
          </li>
        ))}
      </ol>
      <Coverage processes={processes} />
    </div>
  );
}

/** The design problems that name this process, each as a link to its row on the problems page. */
function ProcessProblems({ rows, id }: { rows: ProblemRow[]; id: string }) {
  const t = useText();
  const nav = useLinks();
  const mine = rows.filter((row) => row.process === id);
  if (mine.length === 0) return null;
  return (
    <section className="proc-problems" data-part="process-problems">
      <h2>{t('page.processes.problems')}</h2>
      <ul>{mine.map((row) => <li key={row.id}><a href={nav.problems({ row: row.id })} data-problem-link={row.id}>{`${row.id.toUpperCase()} ${row.summary}`}</a></li>)}</ul>
    </section>
  );
}

/** One process: its steps in order (who, the operation, the feature as a link, the sentence, the citations in the technical view), its end state and the features it passes through. */
function ProcessDetail({ item, rows }: { item: ProcessItem; rows: ProblemRow[] }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const cited = (cites: string[] | undefined) => (view === 'technical' && cites !== undefined && cites.length > 0 ? <Cites cites={cites} /> : null);
  return (
    <div className="wrap processes" data-view="process" data-process={item.id}>
      <Breadcrumbs trail={[{ label: t('page.nav.overview'), href: nav.home }, { label: t('page.nav.processes'), href: nav.processes }, { label: `${item.id} ${item.name}` }]} />
      <h1 className="page-title"><span className="proc-no">{item.id}</span> {item.name}</h1>
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
      <section className="proc-features" data-part="process-features">
        <h2>{t('page.processes.features')}</h2>
        <ul>{item.features.map((id) => <li key={id}><FeatureLink id={id} /></li>)}</ul>
      </section>
      <ProcessProblems rows={rows} id={item.id} />
    </div>
  );
}

/** The route `#/processes` (the list) or `#/processes/P<n>` (one process); `id` is null for the list. The caller has checked that the process exists. */
export function ProcessesPage({ id }: { id: string | null }) {
  const { processes, problems } = useModel();
  if (processes === null) return null;
  if (id === null) return <ProcessList processes={processes} />;
  const item = processes.items.find((entry) => entry.id === id);
  return item === undefined ? null : <ProcessDetail item={item} rows={problems.rows} />;
}
