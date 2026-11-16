import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useProblems } from '../lib/chunks';
import { groupsOf, isFeature, SYSTEM_BLOCK } from '../lib/groups';
import { jumpToHeading } from '../lib/heading-jump';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { ALL_LEVELS, PROBLEM_TYPES, countRows, filterRows, sortRows, typeOfLevel } from '../lib/problems';
import { routeHash } from '../lib/route';
import type { ProblemFilters, ProblemsTab } from '../lib/route';
import { useText } from '../lib/text';
import type { Text } from '../lib/text';
import { numberHeadings } from '../lib/toc';
import type { DesignText, PageData, ProblemRow, ProblemType, View } from '../lib/types';
import { Breadcrumbs } from './Breadcrumbs';
import { ChapterPage } from './ChapterPage';
import { ChunkNotice } from './ChunkNotice';
import { Citation, parseCitation } from './Citation';
import { Markdown } from './Markdown';
import { SelectField } from './ui/Select';
import { FilterToolbar, SearchField } from './ui/Toolbar';

/** The value of the "all" entry of a select: the primitive reserves the empty string. */
const ALL = '*';

const SOURCE_OF: Record<ProblemType, 'defects' | 'design' | 'open'> = { defect: 'defects', design: 'design', open: 'open' };

/** The text of a level: P0 to P2 as they are, an impact by its fixed text. */
const levelText = (t: Text, level: string): string => (typeOfLevel(level) === 'design' ? t(`chapter.review.impact.${level}`) : level);

/**
 * Write the current filters into the address, replacing the history entry (no entry per keystroke). The route follows the
 * address, so the view switch and every other link built from the route carry the filters; the app keeps the scroll position
 * when only the filters change (`placeOf` in App.tsx).
 */
function writeAddress(prefix: View | null, tab: ProblemsTab, filters: ProblemFilters): void {
  const hash = routeHash({ name: 'problems', tab, filters }, prefix);
  if (window.location.hash !== hash) window.location.replace(hash);
}

/** Give the `h2` and `h3` of the remedies chapter their `h-<n>` ids, as the table of contents does elsewhere, so a link can jump to one. */
function useNumberedHeadings(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) return undefined;
    numberHeadings(element);
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => { numberHeadings(element); });
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);
}

function Remedies({ data }: { data: PageData }) {
  const t = useText();
  const root = useRef<HTMLDivElement>(null);
  useNumberedHeadings(root);
  const chapter = data.problems.remedies === null ? undefined : data.chapters.find((candidate) => candidate.id === data.problems.remedies);
  if (chapter === undefined) return <p className="muted" data-part="no-remedies">{t('page.problems.noRemediesChapter')}</p>;
  return <div ref={root} data-part="remedies"><ChapterPage chapter={chapter} /></div>;
}

/** The citations of a row, each as the chip chapters show. */
function Cites({ cites }: { cites: string[] }) {
  return (
    <ul className="prob-cites" role="list" data-part="problem-cites">
      {cites.map((text, at) => {
        const parsed = parseCitation(text);
        return <li key={at}>{parsed === null ? <code>{text}</code> : <Citation file={parsed.file} start={parsed.start} end={parsed.end} />}</li>;
      })}
    </ul>
  );
}

function Detail({ row, filters }: { row: ProblemRow; filters: ProblemFilters }) {
  const t = useText();
  const view = useView();
  const nav = useLinks();
  const { titles } = useModel();
  const text = row.texts[view];
  const featureTitle = (id: string): string => (id === SYSTEM_BLOCK ? t('page.nav.system') : titles[id] ?? id);
  let body = null;
  if (text !== undefined) {
    if (row.type === 'design') {
      const design = text as DesignText;
      body = (
        <>
          <div className="item-field"><span className="inline-label">{t('chapter.review.field.situation')}</span><Markdown source={design.situation} idPrefix={`problem-${row.id}-situation`} /></div>
          <div className="item-field"><span className="inline-label">{t('chapter.review.field.consequence')}</span><Markdown source={design.consequence} idPrefix={`problem-${row.id}-consequence`} /></div>
          {view === 'technical' && row.cites !== undefined && row.cites.length > 0 && <Cites cites={row.cites} />}
        </>
      );
    } else {
      body = <Markdown source={text as string} idPrefix={`problem-${row.id}`} />;
    }
  }
  const group = row.group === null ? null : row.type === 'design'
    ? { label: t('chapter.review.field.dimension'), value: t(`chapter.review.dimension.${row.group}`) }
    : { label: t('page.problems.field.category'), value: row.group };
  return (
    <div className="prob-detail" id={`problem-${row.id}`} data-part="problem-detail">
      {body !== null && <div className="prob-body">{body}</div>}
      {group !== null && <div className="item-field" data-field="group"><span className="inline-label">{group.label}</span> {group.value}</div>}
      <div className="item-field" data-field="features">
        <span className="inline-label">{t('chapter.review.field.features')}</span>{' '}
        {row.features.map((id, at) => <span key={id}>{at > 0 && ', '}<a href={nav.chapter(id)}>{featureTitle(id)}</a></span>)}
      </div>
      {row.type !== 'open' && (
        <div className="item-field" data-field="remedy">
          {row.remedy === null
            ? <span className="muted">{t('page.problems.noRemedy')}</span>
            : <a href={nav.problems(filters, 'remedies')} data-part="remedy-link" onClick={() => { jumpToHeading('remedies', (row.remedy as { heading: number }).heading); }}>{t('page.problems.remedyLink')}</a>}
        </div>
      )}
    </div>
  );
}

function Counts({ data, rows }: { data: PageData; rows: ProblemRow[] }) {
  const t = useText();
  return (
    <div className="prob-counts" data-part="problem-counts">
      {PROBLEM_TYPES.map((type) => {
        const source = data.problems.sources[SOURCE_OF[type]];
        const counted = countRows(rows, type);
        let chips;
        if (source.state !== 'ok') chips = [<li className="stat-chip" key="state" data-state={source.state}>{t(`page.problems.count.${source.state}`)}</li>];
        else if (type === 'open') {
          const incomplete = data.problems.sources.open.unmatched.length > 0;
          chips = [<li className="stat-chip" key="total"><b>{counted.total}</b>{incomplete && ` ${t('page.problems.count.incomplete')}`}</li>];
        } else chips = counted.byLevel.map(({ level, count }) => <li className="stat-chip" key={level} data-level={level}>{levelText(t, level)} <b>{count}</b></li>);
        return (
          <div className="stat-chips" key={type} data-source={type}>
            <span className="stat-chips-title">{t(`page.problems.type.${type}`)}</span>
            <ul role="list">{chips}</ul>
          </div>
        );
      })}
    </div>
  );
}

function List({ data, filters, onFilters }: { data: PageData; filters: ProblemFilters; onFilters: (next: ProblemFilters) => void }) {
  const t = useText();
  const view = useView();
  const model = useModel();
  const detail = useProblems(data.problems.rows);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => groupsOf(data), [data]);
  const rows = detail.status === 'ready' ? detail.value : null;
  const shown = useMemo(() => (rows === null ? [] : sortRows(filterRows(rows, filters, groups, view))), [rows, filters, groups, view]);
  if (rows === null) return <ChunkNotice state={detail as Exclude<typeof detail, { status: 'ready' }>} />;

  const featureTitle = (id: string): string => (id === SYSTEM_BLOCK ? t('page.nav.system') : model.titles[id] ?? id);
  const featureIds = [SYSTEM_BLOCK];
  for (const part of data.outline.parts) for (const block of part.blocks) if (isFeature(block) && !featureIds.includes(block.block)) featureIds.push(block.block);
  for (const row of data.problems.rows) for (const id of row.features) if (!featureIds.includes(id)) featureIds.push(id);

  const option = (value: string | undefined, known: { value: string; label: string }[]): { value: string; label: string }[] => (
    value === undefined || known.some((entry) => entry.value === value) ? known : [...known, { value, label: value }]
  );
  const all = { value: ALL, label: t('page.problems.filter.all') };
  const domains = option(filters.domain, groups.map((group) => ({ value: group.id, label: group.name })));
  const features = option(filters.feature, featureIds.map((id) => ({ value: id, label: featureTitle(id) })));
  const types = option(filters.type, PROBLEM_TYPES.map((type) => ({ value: type, label: t(`page.problems.type.${type}`) })));
  const levels = option(filters.level, ALL_LEVELS.map((level) => ({ value: level, label: levelText(t, level) })));
  const set = (key: keyof ProblemFilters, value: string): ProblemFilters => {
    const next: ProblemFilters = { ...filters };
    if (value === ALL || value === '') delete next[key];
    else next[key] = value;
    return next;
  };
  const choose = (key: keyof ProblemFilters) => (value: string): void => {
    const next = set(key, value);
    // A level belongs to one type: choosing it drops a different type.
    if (key === 'level' && next.level !== undefined && next.type !== undefined && typeOfLevel(next.level) !== next.type) delete next.type;
    onFilters(next);
  };
  const toggle = (id: string): void => setOpen((before) => { const next = new Set(before); if (!next.delete(id)) next.add(id); return next; });

  return (
    <>
      <Counts data={data} rows={filterRows(rows, filters, groups, view)} />
      <FilterToolbar part="problem-filters" status={t('page.problems.status', { shown: shown.length, total: rows.length })}>
        <SelectField name="domain" label={t('page.problems.filter.domain')} value={filters.domain ?? ALL} onValueChange={choose('domain')} options={[all, ...domains]} />
        <SelectField name="feature" label={t('page.problems.filter.feature')} value={filters.feature ?? ALL} onValueChange={choose('feature')} options={[all, ...features]} />
        <SelectField name="type" label={t('page.problems.filter.type')} value={filters.type ?? ALL} onValueChange={choose('type')} options={[all, ...types]} />
        <SelectField name="level" label={t('page.problems.filter.level')} value={filters.level ?? ALL} onValueChange={choose('level')} options={[all, ...levels]} />
        <SearchField label={t('page.problems.filter.search')} value={filters.q ?? ''} onChange={choose('q')} />
      </FilterToolbar>
      {shown.length === 0 ? <p className="muted" data-part="no-rows">{t('page.problems.noRows')}</p> : (
        <div className="prob-table" data-part="problem-table">
          <div className="prob-cols" aria-hidden="true">
            <span>{t('page.problems.col.problem')}</span><span>{t('page.problems.col.features')}</span><span>{t('page.problems.col.type')}</span>
          </div>
          <ul className="prob-list" role="list" aria-label={t('page.problems.title')}>
            {shown.map((row) => {
              const expanded = open.has(row.id);
              const first = row.features.length > 0 ? featureTitle(row.features[0]) : '';
              return (
                <li className="prob" key={row.id} data-problem={row.id} data-type={row.type} data-level={row.level ?? undefined}>
                  <button type="button" className="prob-head" aria-expanded={expanded} aria-controls={`problem-${row.id}`} onClick={() => toggle(row.id)}>
                    <span className="prob-summary">{row.summary}</span>
                    <span className="prob-features" data-part="problem-features">{first}{row.features.length > 1 && <span className="prob-more">{t('page.problems.moreFeatures', { count: row.features.length - 1 })}</span>}</span>
                    <span className="prob-type">{t(`page.problems.type.${row.type}`)}{row.level !== null && <span className="prob-level" data-level={row.level}>{levelText(t, row.level)}</span>}</span>
                  </button>
                  {expanded && <Detail row={row} filters={filters} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * The problems page: a table of every defect, design problem and open question with counts, filters kept in the address, and the
 * remedies chapter as a second tab. Wide, with no side list: it is a place of its own, not a chapter.
 */
export function ProblemsPage({ data, tab, filters: routeFilters }: { data: PageData; tab: ProblemsTab; filters: ProblemFilters }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  // The filters are the page's state, started from the address and followed when the address changes (a link with other filters).
  // The route object changes with the address, so a link to the address the page started at resets them too.
  const [seen, setSeen] = useState(routeFilters);
  const [filters, setFilters] = useState(routeFilters);
  if (seen !== routeFilters) { setSeen(routeFilters); setFilters(routeFilters); }
  const onFilters = (next: ProblemFilters): void => {
    setFilters(next);
    writeAddress(data.views.length > 1 ? view : null, tab, next);
  };
  const lines = PROBLEM_TYPES.flatMap((type) => {
    const source = data.problems.sources[SOURCE_OF[type]];
    return source.state === 'ok' ? [] : [{ type, text: t(`page.problems.state.${source.state}`, { source: t(`page.problems.type.${type}`) }) }];
  });
  const unmatched = data.problems.sources.open.unmatched.length;
  const tabs: { key: ProblemsTab; label: string }[] = [{ key: 'list', label: t('page.problems.tab.list') }, { key: 'remedies', label: t('page.problems.tab.remedies') }];
  return (
    <div className="problems-page" data-view="problems" data-tab={tab}>
      <Breadcrumbs trail={[{ label: t('page.nav.map'), href: nav.home }, { label: t('page.problems.title') }]} />
      <h1 className="page-title">{t('page.problems.title')}</h1>
      <div className="ptabs" role="tablist" aria-label={t('page.problems.tabs')}>
        {tabs.map((entry) => (
          <a key={entry.key} role="tab" href={nav.problems(filters, entry.key)} aria-selected={entry.key === tab} data-tab={entry.key}>{entry.label}</a>
        ))}
      </div>
      <section className="panel" role="tabpanel">
        {tab === 'remedies' ? <Remedies data={data} /> : (
          <>
            {lines.map((line) => <p className="notice prob-state" role="note" key={line.type} data-source={line.type}>{line.text}</p>)}
            {unmatched > 0 && <p className="notice prob-state" role="note" data-part="problem-unmatched">{t('page.problems.unmatched', { count: unmatched, heading: t('chapter.openQuestions') })}</p>}
            <List data={data} filters={filters} onFilters={onFilters} />
          </>
        )}
      </section>
    </div>
  );
}
