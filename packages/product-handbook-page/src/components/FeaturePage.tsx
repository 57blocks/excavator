import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';

import { splitChapter, splitLede, splitServerSteps, previewOf, ROLE_KEYS } from '../lib/feature-split';
import type { Item, Role, Section } from '../lib/feature-split';
import { REVEAL_EVENT } from '../lib/heading-jump';
import { useText } from '../lib/text';
import { ChevronIcon } from './Icons';
import { HandoverStrip } from './HandoverStrip';
import { InlineMarkdown } from './InlineMarkdown';
import { Markdown } from './Markdown';

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROLES = Object.keys(ROLE_KEYS) as Role[];
/** The roles whose sections are not tabs of their own: the overview and hand-overs sit on the overview tab, the last two on the issues tab. */
const OWN_TAB = (role: Role | null): boolean => role !== 'overview' && role !== 'handovers' && role !== 'openQuestions' && role !== 'problems';

interface Tab { key: string; label: string; count: number | null }

const itemKey = (item: Item): string => `i${item.n}`;
const innerKey = (item: Item): string => `i${item.n}-steps`;

/** The page of a feature chapter: the head, then tabs; every piece of the chapter's text is in the page, folded or on a hidden tab. */
export function FeaturePage({ id, view, text }: { id: string; view: string; text: string }) {
  const t = useText();
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
  const issues = sections.filter((section) => section.role === 'openQuestions' || section.role === 'problems');
  const own = sections.filter((section) => OWN_TAB(section.role));
  const { lede, rest: overviewRest } = splitLede(overview?.intro ?? '');

  const tabs: Tab[] = [
    { key: 'overview', label: t('page.feature.overview'), count: null },
    ...own.map((section) => ({ key: `s${section.n}`, label: section.title, count: section.items.length > 0 ? section.items.length : null })),
    ...(issues.length > 0 ? [{ key: 'issues', label: t('page.feature.issues'), count: null }] : []),
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
  const expandAll = (list: readonly Section[]) => {
    const keys = keysOf(list);
    const total = list.reduce((sum, section) => sum + section.items.length, 0);
    if (total < 2) return null;
    const all = keys.every((key) => open.has(key));
    return <button type="button" className="all" onClick={() => setOpenKeys(keys, !all)}>{all ? t('page.feature.collapseAll') : t('page.feature.expandAll')}</button>;
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
      return (
        <>
          <div className="panel-head">{expandAll(issues)}</div>
          {issues.map((section) => (
            <div key={section.n}>
              {heading(section, 'sub')}
              {piece(section.intro, `h${section.n}`)}
              {section.items.map((item) => itemRow(section, item))}
            </div>
          ))}
        </>
      );
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
