import { useState } from 'react';

import { useProblems } from '../lib/chunks';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { levelText } from '../lib/problems';
import { useText } from '../lib/text';
import type { ProblemRow, ProcessItem, ProcessesData } from '../lib/types';
import { Breadcrumbs } from './Breadcrumbs';
import { ChunkNotice } from './ChunkNotice';
import { InlineMarkdown } from './InlineMarkdown';
import { Markdown } from './Markdown';
import { Cites, ProblemBody } from './ProblemsPage';

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

/** A process as a row of the list: its number, its name, and the count of its design problems as a badge besides its step count. */
function ProcessRow({ item, count }: { item: ProcessItem; count: number }) {
  const t = useText();
  const nav = useLinks();
  return (
    <li data-process={item.id}>
      <a href={nav.process(item.id)}>
        <span className="proc-no">{item.id}</span>
        <span className="proc-name">{item.name}</span>
        <span className="proc-count">
          {count > 0 && <span className="proc-badge" data-part="process-problem-count">{t('page.processes.problemCount', { count })}</span>}
          {t('page.processes.stepCount', { count: item.steps.length })}
        </span>
      </a>
    </li>
  );
}

/** The processes of one domain: those with design problems first, then the others under one row that unfolds. */
function ProcessGroup({ id, title, items, counts }: { id: string; title: string | null; items: ProcessItem[]; counts: Record<string, number> }) {
  const t = useText();
  const [open, setOpen] = useState(false);
  const withProblems = items.filter((item) => (counts[item.id] ?? 0) > 0);
  const rest = items.filter((item) => (counts[item.id] ?? 0) === 0);
  return (
    <section className="proc-domain" data-part="process-domain" data-domain={id}>
      {title !== null && <h2 className="proc-domain-title"><span>{title}</span><span className="proc-count" data-part="domain-process-count">{items.length}</span></h2>}
      {withProblems.length > 0 && <ol className="proc-list" data-part="process-list">{withProblems.map((item) => <ProcessRow key={item.id} item={item} count={counts[item.id] ?? 0} />)}</ol>}
      {rest.length > 0 && (
        <>
          <button type="button" className="proc-more" data-part="process-more" aria-expanded={open} onClick={() => setOpen((before) => !before)}>
            <span className="chev" aria-hidden="true" />
            {t('page.processes.more', { count: rest.length })}
          </button>
          {open && <ol className="proc-list" data-part="process-rest">{rest.map((item) => <ProcessRow key={item.id} item={item} count={0} />)}</ol>}
        </>
      )}
    </section>
  );
}

/** The business processes page: the processes of each business domain, in the page's domain order, then the operations in no process. */
function ProcessList({ processes }: { processes: ProcessesData }) {
  const t = useText();
  const nav = useLinks();
  const { domains, problems } = useModel();
  const counts: Record<string, number> = {};
  for (const row of problems.rows) if (row.type === 'design' && row.process !== undefined) counts[row.process] = (counts[row.process] ?? 0) + 1;
  const list = Object.values(domains);
  const known = new Set(list.map((domain) => domain.id));
  const grouped = list.map((domain) => ({ id: domain.id, title: domain.name, items: processes.items.filter((item) => item.domain === domain.id) })).filter((group) => group.items.length > 0);
  const other = processes.items.filter((item) => item.domain === undefined || !known.has(item.domain));
  return (
    <div className="wrap processes" data-view="processes" data-chapter="processes">
      <Breadcrumbs trail={[{ label: t('page.nav.overview'), href: nav.home }, { label: t('page.nav.processes') }]} />
      <h1 className="page-title">{t('page.nav.processes')}</h1>
      {grouped.map((group) => <ProcessGroup key={group.id} id={group.id} title={group.title} items={group.items} counts={counts} />)}
      {other.length > 0 && <ProcessGroup id="other" title={grouped.length > 0 ? t('page.processes.noDomain') : null} items={other} counts={counts} />}
      <Coverage processes={processes} />
    </div>
  );
}

/** The design problems that name this process, each with its title, impact, situation, consequence and (technical view) citations, and a link to its row. */
function ProcessProblems({ rows, id }: { rows: ProblemRow[]; id: string }) {
  const t = useText();
  const nav = useLinks();
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
            <a className="proc-row-link" href={nav.problems({ row: row.id })} data-problem-link={row.id}>{t('page.processes.viewRow')}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The improvement suggestions written under this process, in chapter order, each as the remedies page shows an item (with a line for each problem it names). */
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
            <Markdown source={`- ${remedy.text}`} idPrefix={`process-${item.id}-remedy-${remedy.line}`} remedyItem={{ lineOffset: remedy.line - 1 }} />
          </li>
        ))}
      </ul>
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
    <div className="wrap processes" data-view="process" data-chapter="processes" data-process={item.id}>
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
      <ProcessProblems rows={rows} id={item.id} />
      <ProcessSuggestions item={item} />
      <section className="proc-features" data-part="process-features">
        <h2>{t('page.processes.features')}</h2>
        <ul>{item.features.map((id) => <li key={id}><FeatureLink id={id} /></li>)}</ul>
      </section>
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
