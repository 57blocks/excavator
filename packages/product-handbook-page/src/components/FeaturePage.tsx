import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';

import { splitChapter, splitLede, splitServerSteps, previewOf, ROLE_KEYS } from '../lib/feature-split';
import type { Item, Role, Section } from '../lib/feature-split';
import { useProblems } from '../lib/chunks';
import { REVEAL_EVENT } from '../lib/heading-jump';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { PROBLEM_TYPES, highestLevels, levelText, rowsOfFeature, sortRows } from '../lib/problems';
import { useText } from '../lib/text';
import type { ProblemRow, ProblemType } from '../lib/types';
import { ChevronIcon, FoldAllIcon } from './Icons';
import { ChunkNotice } from './ChunkNotice';
import { ProblemDetail } from './ProblemsPage';
import { FeatureNav } from './FeatureNav';
import type { NavEntry } from './FeatureNav';
import { HandoverStrip, stripRows } from './HandoverStrip';
import { InlineMarkdown } from './InlineMarkdown';
import { Markdown } from './Markdown';

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROLES = Object.keys(ROLE_KEYS) as Role[];
const SOURCE_OF: Record<ProblemType, 'defects' | 'design' | 'open'> = { defect: 'defects', design: 'design', open: 'open' };
const problemKey = (row: ProblemRow): string => `p-${row.id}`;

const itemKey = (item: Item): string => `i${item.n}`;
const innerKey = (item: Item): string => `i${item.n}-steps`;

/** The page of a feature chapter: the head, then five blocks (overview, pages and operations, rules and behavior, problems, upstream and downstream) with the sections the page cannot place in blocks of their own; one page, no tabs. */
export function FeaturePage({ id, view, text }: { id: string; view: string; text: string }) {
  const t = useText();
  const nav = useLinks();
  const current = useView();
  const model = useModel();
  const root = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const titles = useMemo(() => Object.fromEntries(ROLES.map((role) => [role, t(ROLE_KEYS[role])])) as Record<Role, string>, [t]);
  const serverSteps = t('chapter.serverSteps');
  const split = useMemo(() => splitChapter(text, titles), [text, titles]);
  // The head is what comes before the first `##`: the level-1 heading, its notices, and anything else written there.
  const { head, sections } = split;
  const byRole = (role: Role): Section | undefined => sections.find((section) => section.role === role);
  const overview = byRole('overview');
  const handovers = byRole('handovers');
  // The problems block is built from the problems table; the chapter's own problems section is shown only when the defects chapter cannot be used.
  const ownProblems = sections.filter((section) => section.role === 'problems');
  const ownOpen = byRole('openQuestions');
  const sources = model.problems.sources;
  const mine = useMemo(() => rowsOfFeature(model.problems.rows, id), [model.problems.rows, id]);
  const detail = useProblems(model.problems.rows);
  const full = useMemo(() => (detail.status === 'ready' ? new Map(detail.value.map((row) => [row.id, row])) : null), [detail]);
  // A type's heading keeps the number of the chapter's own section when there is one (search points at it), else a fixed id.
  const typeIdOf: Record<ProblemType, string> = { defect: ownProblems[0] === undefined ? 'prob-defect' : `h-${ownProblems[0].n}`, design: 'prob-design', open: ownOpen === undefined ? 'prob-open' : `h-${ownOpen.n}` };
  const { lede, rest: overviewRest } = splitLede(overview?.intro ?? '');
  const links = stripRows(model, id);

  const setOpenKeys = useCallback((keys: readonly string[], on: boolean) => {
    setOpen((before) => {
      const next = new Set(before);
      for (const key of keys) { if (on) next.add(key); else next.delete(key); }
      return next;
    });
  }, []);

  // A heading found by the jump of the page (search, links) opens the folds that hold it. The browser's own find opens a closed
  // `details` by itself and its toggle event keeps the state in step.
  useEffect(() => {
    const element = root.current;
    if (element === null) return undefined;
    const onReveal = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const keys = Array.from(element.querySelectorAll<HTMLElement>('details[data-key]')).filter((details) => details.contains(target)).map((details) => details.dataset.key as string);
      flushSync(() => setOpenKeys(keys, true));
    };
    element.addEventListener(REVEAL_EVENT, onReveal);
    return () => element.removeEventListener(REVEAL_EVENT, onReveal);
  }, [setOpenKeys]);

  const goToType = (type: ProblemType): void => {
    const heading = root.current?.querySelector<HTMLElement>(`[data-problem-type="${type}"]`);
    if (heading === null || heading === undefined) return;
    heading.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    heading.focus({ preventScroll: true });
  };

  const piece = (source: string, name: string) => (source.trim() === '' ? null : <Markdown source={source} idPrefix={`${id}-${name}`} chapter={id} />);

  const itemBody = (section: Section, item: Item) => {
    const split = section.role === 'operations' ? splitServerSteps(item.body, serverSteps) : null;
    if (split === null) return piece(item.body, `b${item.n}`);
    return (
      <>
        {piece(split.before, `b${item.n}`)}
        <details className="inner" data-key={innerKey(item)} open={open.has(innerKey(item))} onToggle={(event) => setOpenKeys([innerKey(item)], event.currentTarget.open)}>
          <summary><span className="chev"><ChevronIcon /></span>{split.title}</summary>
          {piece(split.after, `c${item.n}`)}
        </details>
      </>
    );
  };

  const itemRow = (section: Section, item: Item) => {
    const key = itemKey(item);
    return (
      <details key={item.n} className="fold" data-key={key} open={open.has(key)} onToggle={(event) => setOpenKeys([key], event.currentTarget.open)}>
        <summary>
          <span className="chev"><ChevronIcon /></span>
          <h4 id={`h-${item.n}`} tabIndex={-1} className="t"><InlineMarkdown source={item.title} links={false} /></h4>
          <span className="p">{previewOf(item.body)}</span>
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
    return <button type="button" className="all" aria-expanded={all} onClick={() => setOpenKeys(keys, !all)}><FoldAllIcon open={all} /><span>{all ? t('page.feature.collapseAll') : t('page.feature.expandAll')}</span></button>;
  };

  const problemFold = (row: ProblemRow) => {
    const key = problemKey(row);
    const text = full?.get(row.id);
    return (
      <details key={row.id} className="fold" data-key={key} data-problem={row.id} open={open.has(key)} onToggle={(event) => setOpenKeys([key], event.currentTarget.open)}>
        <summary>
          <span className="chev"><ChevronIcon /></span>
          <span className="t" title={row.summary}>{row.level !== null && <span className="lvl" data-level={row.level}>{levelText(t, row.level)}</span>}{row.summary}</span>
        </summary>
        <div className="item-body">{text !== undefined && <ProblemDetail row={text} />}</div>
      </details>
    );
  };

  /**
   * The problems of the feature under the head: its title with the way to the table at the right, then the three counts as large
   * numbers (each a jump to its part of the problems block), defects and design problems followed by the highest level of their type.
   */
  const problemsLine = () => {
    const unmatched = sources.open.unmatched.includes(id);
    const allOk = PROBLEM_TYPES.every((type) => sources[SOURCE_OF[type]].state === 'ok');
    const top = highestLevels(model.problems.rows, id);
    const none = allOk && !unmatched && mine.length === 0;
    return (
      <section className="feature-problems" data-part="feature-problems">
        <div className="fp-head">
          <p className="fp-title">{t('page.feature.problems.title')}</p>
          {!none && <a className="fp-all" href={nav.problems({ feature: id })} data-part="feature-problems-all">{t('page.feature.problems.viewAll')}<ChevronIcon /></a>}
        </div>
        {none ? <p className="muted" data-part="feature-problems-none">{t('page.feature.problems.none')}</p> : (
          <ul className="fp-counts" role="list" data-part="feature-problem-counts">
            {PROBLEM_TYPES.map((type) => {
              const source = sources[SOURCE_OF[type]];
              const count = mine.filter((row) => row.type === type).length;
              const level = type === 'open' ? null : top[type];
              return (
                <li key={type} data-source={type} data-state={source.state !== 'ok' ? source.state : undefined}>
                  {source.state !== 'ok' ? <><span className="fp-type">{t(`page.problems.type.${type}`)}</span>{' '}<span className="muted">{t(`page.problems.count.${source.state}`)}</span></> : (
                    <>
                      <button type="button" className="fp-count" data-count-type={type} onClick={() => goToType(type)}>{count}</button>
                      <span className="fp-type">{t(`page.problems.type.${type}`)}</span>
                      {level !== null && <span className="lvl" data-level={level} data-part="feature-top-level">{levelText(t, level)}</span>}
                      {type === 'open' && unmatched && <span className="muted">{t('page.problems.count.incomplete')}</span>}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };

  const problemsBody = () => {
    const defects = sources.defects;
    const design = sources.design;
    const open_ = sources.open;
    const ranked = sortRows(mine);
    const of = (type: ProblemType): ProblemRow[] => ranked.filter((row) => row.type === type);
    const none = <p className="muted">{t('chapter.none')}</p>;
    const unmatched = open_.unmatched.includes(id);
    const stateLine = (type: ProblemType, state: string) => <p className="muted" data-part="issues-state" data-source={type}>{t(`page.problems.state.${state}`, { source: t(`page.problems.type.${type}`) })}</p>;
    const anchor = (type: ProblemType) => ({ id: typeIdOf[type], tabIndex: -1, 'data-problem-type': type });
    return (
      <>
        <h3 className="sub" {...anchor('defect')}>{t('page.problems.type.defect')}</h3>
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
        <h3 className="sub" {...anchor('design')}>{t('page.problems.type.design')}</h3>
        {design.state !== 'ok' ? stateLine('design', design.state) : of('design').length === 0 ? none : of('design').map(problemFold)}
        <h3 className="sub" {...anchor('open')}>{t('page.problems.type.open')}</h3>
        {open_.state !== 'ok' && stateLine('open', open_.state)}
        {unmatched && <p className="notice" role="note" data-part="issues-open-unmatched">{t('page.feature.problems.openUnmatched', { heading: t('chapter.openQuestions') })}</p>}
        {open_.state === 'ok' && (of('open').length > 0 ? of('open').map(problemFold) : unmatched ? null : none)}
        {mine.length > 0 && detail.status !== 'ready' && <ChunkNotice state={detail} />}
      </>
    );
  };

  const plain = (title: string): string => title.replace(/[`*_]/g, '');
  const entries: NavEntry[] = [];

  /** A section inside a block: its own title as an `h3` with the number of its items, its intro, its items as folds. */
  const sectionNode = (section: Section) => {
    entries.push({ id: `h-${section.n}`, label: plain(section.title), level: 3 });
    return (
      <div key={section.n} className="fsection">
        <div className="fsection-head">
          <h3 id={`h-${section.n}`} tabIndex={-1}><InlineMarkdown source={section.title} links={false} /></h3>
          {section.items.length > 0 && <span className="fcount" data-part="section-count" aria-hidden="true">{section.items.length}</span>}
        </div>
        {piece(section.intro, `h${section.n}`)}
        {section.items.map((item) => itemRow(section, item))}
      </div>
    );
  };

  const block = (name: string, titleKey: string, children: () => ReactNode, list: readonly Section[], extra: readonly string[] = []) => {
    const title = t(titleKey);
    entries.push({ id: `blk-${name}`, label: title, level: 2 });
    const inside = children();
    return (
      <section key={name} className="fblock" data-block={name}>
        <div className="panel-head"><h2 id={`blk-${name}`} tabIndex={-1}>{title}</h2>{expandAll(list, extra)}</div>
        {inside}
      </section>
    );
  };

  const pick = (...roles: Role[]): Section[] => roles.flatMap((role) => sections.filter((section) => section.role === role));
  const use = pick('screens', 'operations');
  const behavior = pick('rules', 'states', 'notifications');
  const others = sections.filter((section) => section.role === null);
  const overviewHasContent = overview !== undefined && (overviewRest.trim() !== '' || overview.items.length > 0);
  const blocks: ReactNode[] = [];
  if (overview !== undefined && overviewHasContent) {
    blocks.push(block('overview', 'page.feature.block.overview', () => (
      <>
        <h3 id={`h-${overview.n}`} tabIndex={-1} className="sr-only"><InlineMarkdown source={overview.title} links={false} /></h3>
        {piece(overviewRest, 'overview')}
        {overview.items.map((item) => itemRow(overview, item))}
      </>
    ), [overview]));
  }
  if (use.length > 0) blocks.push(block('use', 'page.feature.block.use', () => use.map(sectionNode), use));
  if (behavior.length > 0) blocks.push(block('behavior', 'page.feature.block.behavior', () => behavior.map(sectionNode), behavior));
  for (const section of others) {
    entries.push({ id: `h-${section.n}`, label: plain(section.title), level: 2 });
    blocks.push(
      <section key={`other-${section.n}`} className="fblock" data-block="other">
        <div className="panel-head"><h2 id={`h-${section.n}`} tabIndex={-1}><InlineMarkdown source={section.title} links={false} /></h2>{expandAll([section])}</div>
        {piece(section.intro, `h${section.n}`)}
        {section.items.map((item) => itemRow(section, item))}
      </section>,
    );
  }
  // The problems block always shows: counts, fallbacks and the state of each source are its content.
  blocks.push(block('problems', 'page.feature.block.problems', problemsBody, sources.defects.state === 'ok' ? [] : ownProblems, mine.map(problemKey)));
  if (handovers !== undefined || links.length > 0) {
    const kept = handovers === undefined ? [] : [handovers];
    blocks.push(block('links', 'page.feature.block.links', () => (
      <>
        {links.length > 0 && <p className="links-hint" data-part="links-hint">{t('page.feature.links.hint')}</p>}
        {/* The block's title stands for the section's own heading, as in the overview block: kept for search, hidden, not in the nav. */}
        {handovers !== undefined && (
          <div className="fsection">
            <h3 id={`h-${handovers.n}`} tabIndex={-1} className="sr-only"><InlineMarkdown source={handovers.title} links={false} /></h3>
            {piece(handovers.intro, `h${handovers.n}`)}
            {handovers.items.map((item) => itemRow(handovers, item))}
          </div>
        )}
        <HandoverStrip chapter={id} />
      </>
    ), kept));
  }
  // The three types of the problems block and nothing else of it are entries of the page nav.
  const at = entries.findIndex((entry) => entry.id === 'blk-problems');
  entries.splice(at + 1, 0, ...PROBLEM_TYPES.map((type): NavEntry => ({ id: typeIdOf[type], label: t(`page.problems.type.${type}`), level: 3 })));

  return (
    <div className="feature-layout">
      <article ref={root} className="page feature" data-view={view} data-chapter={id}>
        {head !== '' && <Markdown source={head} idPrefix={`${id}-head`} chapter={id} />}
        {lede !== '' && <div className="lede"><Markdown source={lede} idPrefix={`${id}-lede`} chapter={id} /></div>}
        {overview !== undefined && !overviewHasContent && <h3 id={`h-${overview.n}`} tabIndex={-1} className="sr-only"><InlineMarkdown source={overview.title} links={false} /></h3>}
        {problemsLine()}
        {blocks}
      </article>
      {/* One list per chapter: two chapters can have the same ids (blk-*, h-<n>), and a pin or a mark must not carry over. */}
      <FeatureNav key={`${current}:${id}`} entries={entries} />
    </div>
  );
}
