import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';

import { splitChapter, splitLede, splitServerSteps, previewOf, ROLE_KEYS } from '../lib/feature-split';
import type { Item, Role, Section } from '../lib/feature-split';
import { useProblems } from '../lib/chunks';
import { REVEAL_EVENT } from '../lib/heading-jump';
import { useLinks } from '../lib/links';
import { useModel } from '../lib/model';
import { PROBLEM_TYPES, levelText, rowsOfFeature, sortRows } from '../lib/problems';
import { useText } from '../lib/text';
import type { ProblemRow, ProblemType } from '../lib/types';
import { ChevronIcon } from './Icons';
import { ChunkNotice } from './ChunkNotice';
import { ProblemDetail } from './ProblemsPage';
import { HandoverStrip } from './HandoverStrip';
import { InlineMarkdown } from './InlineMarkdown';
import { Markdown } from './Markdown';

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROLES = Object.keys(ROLE_KEYS) as Role[];
/** The roles whose sections are not tabs of their own: the overview and hand-overs sit on the overview tab, the last two on the issues tab. */
const OWN_TAB = (role: Role | null): boolean => role !== 'overview' && role !== 'handovers' && role !== 'openQuestions' && role !== 'problems';
/** How many problems the block of a feature lists at most. */
const TOP = 3;
const SOURCE_OF: Record<ProblemType, 'defects' | 'design' | 'open'> = { defect: 'defects', design: 'design', open: 'open' };
const problemKey = (row: ProblemRow): string => `p-${row.id}`;

interface Tab { key: string; label: string; count: number | null }

const itemKey = (item: Item): string => `i${item.n}`;
const innerKey = (item: Item): string => `i${item.n}-steps`;

/** The page of a feature chapter: the head, then tabs; every piece of the chapter's text is in the page, folded or on a hidden tab. */
export function FeaturePage({ id, view, text }: { id: string; view: string; text: string }) {
  const t = useText();
  const nav = useLinks();
  const model = useModel();
  const root = useRef<HTMLElement>(null);
  const [tab, setTab] = useState('overview');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const titles = useMemo(() => Object.fromEntries(ROLES.map((role) => [role, t(ROLE_KEYS[role])])) as Record<Role, string>, [t]);
  const serverSteps = t('chapter.serverSteps');
  const split = useMemo(() => splitChapter(text, titles), [text, titles]);
  // The head is what comes before the first `##`: the level-1 heading, its notices, and anything else written there.
  const { head, sections } = split;
  const overview = sections.find((section) => section.role === 'overview');
  const operations = sections.find((section) => section.role === 'operations');
  const screens = sections.find((section) => section.role === 'screens');
  const handovers = sections.find((section) => section.role === 'handovers');
  // The issues tab is built from the problems table; the chapter's own problems section is shown only when the defects chapter cannot be used.
  const ownProblems = sections.filter((section) => section.role === 'problems');
  const ownOpen = sections.find((section) => section.role === 'openQuestions');
  const sources = model.problems.sources;
  const mine = useMemo(() => rowsOfFeature(model.problems.rows, id), [model.problems.rows, id]);
  const detail = useProblems(model.problems.rows);
  const full = useMemo(() => (detail.status === 'ready' ? new Map(detail.value.map((row) => [row.id, row])) : null), [detail]);
  const own = sections.filter((section) => OWN_TAB(section.role));
  const { lede, rest: overviewRest } = splitLede(overview?.intro ?? '');

  const tabs: Tab[] = [
    { key: 'overview', label: t('page.feature.overview'), count: null },
    ...own.map((section) => ({ key: `s${section.n}`, label: section.title, count: section.items.length > 0 ? section.items.length : null })),
    { key: 'issues', label: t('page.feature.issues'), count: mine.length > 0 ? mine.length : null },
  ];
  const tabOf = (section: Section): string => `s${section.n}`;

  const setOpenKeys = useCallback((keys: readonly string[], on: boolean) => {
    setOpen((before) => {
      const next = new Set(before);
      for (const key of keys) { if (on) next.add(key); else next.delete(key); }
      return next;
    });
  }, []);

  // React 19 cannot write `hidden="until-found"` (it turns any string into a plain `hidden`), so the attribute is set here:
  // the panels of the other tabs stay in the page and the browser's find opens them (`beforematch`).
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => {
      if (panel.dataset.panel === tab) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', 'until-found');
    });
  });

  // A heading found by the jump of the page (search, links) or an item found by the browser's find: show its tab and open its folds.
  useEffect(() => {
    const element = root.current;
    if (element === null) return undefined;
    const reveal = (target: EventTarget | null): void => {
      if (!(target instanceof HTMLElement)) return;
      const panel = target.closest<HTMLElement>('[data-panel]');
      const keys = Array.from(element.querySelectorAll<HTMLElement>('details[data-key]')).filter((details) => details.contains(target)).map((details) => details.dataset.key as string);
      flushSync(() => {
        if (panel !== null) setTab(panel.dataset.panel as string);
        setOpenKeys(keys, true);
      });
    };
    const onFound = (event: Event): void => {
      // `beforematch` fires on the hidden panel itself.
      const panel = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-panel]') : null;
      if (panel !== null) setTab(panel.dataset.panel as string);
    };
    const onReveal = (event: Event): void => reveal(event.target);
    element.addEventListener('beforematch', onFound, true);
    element.addEventListener(REVEAL_EVENT, onReveal);
    return () => {
      element.removeEventListener('beforematch', onFound, true);
      element.removeEventListener(REVEAL_EVENT, onReveal);
    };
  }, [setOpenKeys]);

  const goTo = (section: Section, item: Item): void => {
    flushSync(() => {
      setTab(tabOf(section));
      setOpenKeys([itemKey(item)], true);
    });
    const heading = root.current?.querySelector<HTMLElement>(`#h-${item.n}`);
    if (heading === null || heading === undefined) return;
    heading.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    heading.focus({ preventScroll: true });
  };

  const goToProblem = (row: ProblemRow): void => {
    flushSync(() => {
      setTab('issues');
      setOpenKeys([problemKey(row)], true);
    });
    const fold = root.current?.querySelector<HTMLElement>(`details[data-problem="${CSS.escape(row.id)}"]`);
    if (fold === null || fold === undefined) return;
    fold.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    fold.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  };

  const choose = (key: string, focus = false): void => {
    setTab(key);
    const list = root.current?.querySelector<HTMLElement>('[role="tablist"]');
    if (focus) root.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-tab-${key}`)}`)?.focus();
    if (list !== null && list !== undefined && list.getBoundingClientRect().top <= (document.querySelector('.topbar')?.getBoundingClientRect().height ?? 60) + 2) {
      list.scrollIntoView({ block: 'start' });
    }
  };
  const onTabKey = (event: KeyboardEvent<HTMLElement>, at: number): void => {
    const last = tabs.length - 1;
    const to = event.key === 'ArrowRight' ? (at === last ? 0 : at + 1) : event.key === 'ArrowLeft' ? (at === 0 ? last : at - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    if (to === -1) return;
    event.preventDefault();
    choose(tabs[to].key, true);
  };

  const piece = (source: string, name: string) => (source.trim() === '' ? null : <Markdown source={source} idPrefix={`${id}-${name}`} chapter={id} />);

  const itemBody = (section: Section, item: Item) => {
    const split = section.role === 'operations' ? splitServerSteps(item.body, serverSteps) : null;
    if (split === null) return piece(item.body, `b${item.n}`);
    return (
      <>
        {piece(split.before, `b${item.n}`)}
        <details className="inner" data-key={innerKey(item)} open={open.has(innerKey(item))} onToggle={(event) => setOpenKeys([innerKey(item)], event.currentTarget.open)}>
          <summary>{split.title}</summary>
          {piece(split.after, `c${item.n}`)}
        </details>
      </>
    );
  };

  const itemRow = (section: Section, item: Item) => {
    const key = itemKey(item);
    return (
      <details key={item.n} className="item" data-key={key} open={open.has(key)} onToggle={(event) => setOpenKeys([key], event.currentTarget.open)}>
        <summary>
          <h3 id={`h-${item.n}`} tabIndex={-1} className="t"><InlineMarkdown source={item.title} links={false} /></h3>
          <span className="p">{previewOf(item.body)}</span>
          <span className="chev"><ChevronIcon /></span>
        </summary>
        <div className="item-body">{itemBody(section, item)}</div>
      </details>
    );
  };

  const keysOf = (list: readonly Section[]): string[] => list.flatMap((section) => section.items.flatMap((item) => [itemKey(item), ...(section.role === 'operations' && splitServerSteps(item.body, serverSteps) !== null ? [innerKey(item)] : [])]));
  const expandAll = (list: readonly Section[], extra: readonly string[] = []) => {
    const keys = [...extra, ...keysOf(list)];
    if (keys.length < 2) return null;
    const all = keys.every((key) => open.has(key));
    return <button type="button" className="all" onClick={() => setOpenKeys(keys, !all)}>{all ? t('page.feature.collapseAll') : t('page.feature.expandAll')}</button>;
  };

  const problemFold = (row: ProblemRow) => {
    const key = problemKey(row);
    const text = full?.get(row.id);
    return (
      <details key={row.id} className="item" data-key={key} data-problem={row.id} open={open.has(key)} onToggle={(event) => setOpenKeys([key], event.currentTarget.open)}>
        <summary>
          <span className="t">{row.level !== null && <span className="lvl" data-level={row.level}>{levelText(t, row.level)}</span>}{row.summary}</span>
          <span className="chev"><ChevronIcon /></span>
        </summary>
        <div className="item-body">{text !== undefined && <ProblemDetail row={text} filters={{}} />}</div>
      </details>
    );
  };

  /** The block under the head: the counts of this feature's problems, its worst three, and the way to the rest. */
  const problemsBlock = () => {
    const unmatched = sources.open.unmatched.includes(id);
    const allOk = PROBLEM_TYPES.every((type) => sources[SOURCE_OF[type]].state === 'ok');
    const top = sortRows(mine.filter((row) => row.type !== 'open')).slice(0, TOP);
    return (
      <section className="feature-problems" data-part="feature-problems">
        <h2 className="sub">{t('page.feature.problems.title')}</h2>
        {allOk && !unmatched && mine.length === 0 ? <p className="muted" data-part="feature-problems-none">{t('page.feature.problems.none')}</p> : (
          <>
            <ul className="fp-counts" role="list" data-part="feature-problem-counts">
              {PROBLEM_TYPES.map((type) => {
                const source = sources[SOURCE_OF[type]];
                const count = mine.filter((row) => row.type === type).length;
                return (
                  <li key={type} data-source={type} data-state={source.state !== 'ok' ? source.state : undefined}>
                    <span className="fp-type">{t(`page.problems.type.${type}`)}</span>{' '}
                    {source.state !== 'ok' ? <span className="muted">{t(`page.problems.count.${source.state}`)}</span> : (
                      <>
                        <b>{count}</b>
                        {type === 'open' && unmatched && <>{' '}<span className="muted">{t('page.problems.count.incomplete')}</span></>}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            {top.length > 0 && (
              <ul className="fp-top" role="list" data-part="feature-problem-top">
                {top.map((row) => (
                  <li key={row.id}>
                    <button type="button" data-top-problem={row.id} onClick={() => goToProblem(row)}>
                      {row.level !== null && <span className="lvl" data-level={row.level}>{levelText(t, row.level)}</span>}<span className="fp-summary">{row.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="fp-links">
              <button type="button" className="linklike" data-part="feature-problems-tab" onClick={() => choose('issues')}>{t('page.feature.problems.openTab')}</button>
              <a href={nav.problems({ feature: id })} data-part="feature-problems-all">{t('page.feature.problems.viewAll')}</a>
            </p>
          </>
        )}
      </section>
    );
  };

  const issuesPanel = () => {
    const defects = sources.defects;
    const design = sources.design;
    const open_ = sources.open;
    const ranked = sortRows(mine);
    const of = (type: ProblemType): ProblemRow[] => ranked.filter((row) => row.type === type);
    const none = <p className="muted">{t('chapter.none')}</p>;
    const unmatched = open_.unmatched.includes(id);
    const stateLine = (type: ProblemType, state: string) => <p className="muted" data-part="issues-state" data-source={type}>{t(`page.problems.state.${state}`, { source: t(`page.problems.type.${type}`) })}</p>;
    const anchor = (section: Section | undefined) => (section === undefined ? {} : { id: `h-${section.n}`, tabIndex: -1 });
    return (
      <>
        <div className="panel-head">{expandAll(defects.state === 'ok' ? [] : ownProblems, mine.map(problemKey))}</div>
        <h2 className="sub" {...anchor(ownProblems[0])}>{t('page.problems.type.defect')}</h2>
        {defects.state === 'ok' ? (of('defect').length === 0 ? none : of('defect').map(problemFold)) : (
          <>
            <p className="notice" role="note" data-part="issues-unranked">{t('page.feature.problems.unranked', { reason: t(`page.problems.count.${defects.state}`) })}</p>
            {ownProblems.length === 0 ? none : ownProblems.map((section) => (
              <div key={section.n}>
                {piece(section.intro, `h${section.n}`)}
                {section.items.map((item) => itemRow(section, item))}
              </div>
            ))}
          </>
        )}
        <h2 className="sub">{t('page.problems.type.design')}</h2>
        {design.state !== 'ok' ? stateLine('design', design.state) : of('design').length === 0 ? none : of('design').map(problemFold)}
        <h2 className="sub" {...anchor(ownOpen)}>{t('page.problems.type.open')}</h2>
        {open_.state !== 'ok' && stateLine('open', open_.state)}
        {unmatched && <p className="notice" role="note" data-part="issues-open-unmatched">{t('page.feature.problems.openUnmatched', { heading: t('chapter.openQuestions') })}</p>}
        {open_.state === 'ok' && (of('open').length > 0 ? of('open').map(problemFold) : unmatched ? null : none)}
        {mine.length > 0 && detail.status !== 'ready' && <ChunkNotice state={detail} />}
      </>
    );
  };

  const rows = (section: Section) => (
    <ul className="tasks">
      {section.items.map((item) => (
        <li key={item.n}>
          <button type="button" onClick={() => goTo(section, item)}>
            <span className="t"><InlineMarkdown source={item.title} links={false} /></span>
            <span className="p">{previewOf(item.body)}</span>
            <span className="go"><ChevronIcon /></span>
          </button>
        </li>
      ))}
    </ul>
  );

  const heading = (section: Section, className: string) => <h2 id={`h-${section.n}`} tabIndex={-1} className={className}><InlineMarkdown source={section.title} links={false} /></h2>;

  const panel = (key: string) => {
    if (key === 'overview') {
      return (
        <>
          {overview !== undefined && heading(overview, 'sr-only')}
          {piece(overviewRest, 'overview')}
          {operations !== undefined && operations.items.length > 0 && <><h2 className="sub">{t('page.feature.canDo')}</h2>{rows(operations)}</>}
          {screens !== undefined && screens.items.length > 0 && <><h2 className="sub">{t('page.feature.screens')}</h2>{rows(screens)}</>}
          {handovers !== undefined && (
            <>
              {heading(handovers, 'sub')}
              {piece(handovers.intro, `h${handovers.n}`)}
              {handovers.items.map((item) => itemRow(handovers, item))}
            </>
          )}
          {overview !== undefined && overview.items.length > 0 && <><h2 className="sub">{t('page.feature.more')}</h2>{overview.items.map((item) => itemRow(overview, item))}</>}
        </>
      );
    }
    if (key === 'issues') {
      return issuesPanel();
    }
    const section = own.find((candidate) => tabOf(candidate) === key) as Section;
    return (
      <>
        <div className="panel-head">{heading(section, '')}{expandAll([section])}</div>
        {piece(section.intro, `h${section.n}`)}
        {section.items.map((item) => itemRow(section, item))}
      </>
    );
  };

  return (
    <article ref={root} className="page feature" data-view={view} data-chapter={id}>
      {head !== '' && <Markdown source={head} idPrefix={`${id}-head`} chapter={id} />}
      {lede !== '' && <div className="lede"><Markdown source={lede} idPrefix={`${id}-lede`} chapter={id} /></div>}
      <HandoverStrip chapter={id} />
      {problemsBlock()}
      <div className="tabs" role="tablist" aria-label={t('page.feature.tabs')}>
        {tabs.map((entry, at) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            id={`${id}-tab-${entry.key}`}
            aria-selected={entry.key === tab}
            aria-controls={`${id}-panel-${entry.key}`}
            tabIndex={entry.key === tab ? 0 : -1}
            onClick={() => choose(entry.key)}
            onKeyDown={(event) => onTabKey(event, at)}
          >
            {entry.label}{entry.count !== null && <span className="n">{entry.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((entry) => (
        <section
          key={entry.key}
          className="panel"
          role="tabpanel"
          id={`${id}-panel-${entry.key}`}
          aria-labelledby={`${id}-tab-${entry.key}`}
          data-panel={entry.key}
        >
          {panel(entry.key)}
        </section>
      ))}
    </article>
  );
}
