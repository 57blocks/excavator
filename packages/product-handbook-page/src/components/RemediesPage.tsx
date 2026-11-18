import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import { jumpToAnchor } from '../lib/heading-jump';
import { useLinks } from '../lib/links';
import { categoryText } from '../lib/problems';
import { onlyBeforeSections, onlyGeneratedSection, withoutProcessSections } from '../lib/remedy-fold';
import { useModel } from '../lib/model';
import { useText } from '../lib/text';
import { numberHeadings } from '../lib/toc';
import type { PageData, RemedyDomains, RemedyGroup, RemedyRef } from '../lib/types';
import { useView } from '../lib/links';
import { Breadcrumbs } from './Breadcrumbs';
import { ChapterPage } from './ChapterPage';
import { RemedyItem } from './RemedyItem';
import { Toc } from './Toc';

/** Give the `h2` and `h3` of the chapter their `h-<n>` ids, as the table of contents does elsewhere, so a link can jump to one even before the list is drawn. */
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

/**
 * One section in place of the sections of the processes (the level-2 sections `P<n> <name>` of the chapter): one row for each process
 * that has suggestions, with their number, linking to the page of the process where they are shown in full. Null without any.
 */
function ProcessSuggestions({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const rows = (data.processes?.items ?? []).filter((item) => item.remedies !== undefined && item.remedies.length > 0);
  if (rows.length === 0) return null;
  return (
    <section className="prose remedy-fold" data-part="remedy-processes">
      <h2>{t('page.remedies.processes')}</h2>
      <ul className="proc-list" aria-label={t('page.remedies.processes')}>
        {rows.map((item) => (
          <li key={item.id} data-process={item.id}>
            <a href={nav.process(item.id)}>
              <span className="proc-name">{item.name}</span>
              <span className="proc-count">{t('page.remedies.suggestionCount', { count: item.remedies?.length ?? 0 })}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The text of an item without its leading bold type word, for an item whose group has the one type. */
const withoutType = (text: string): string => text.replace(/^\*\*[^*]+\*\*\s*/, '');

/** The items of one place of a tab: each in plain text with the problem row of this place, its id made from `prefix` and its line; one written under a process has a first row with the process as a link to its page. */
function Items({ refs, prefix }: { refs: RemedyRef[]; prefix: string }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const { remedyDomains, processes } = useModel();
  const texts = new Map((remedyDomains?.items ?? []).map((item) => [item.line, item.texts[view]]));
  const processName = new Map((processes?.items ?? []).map((item) => [item.id, item.name]));
  const shown = refs.flatMap((ref) => { const text = texts.get(ref.line); return text === undefined ? [] : [{ ref, text: ref.bare === true ? withoutType(text) : text }]; });
  return (
    <ul className="proc-rows">
      {shown.map(({ ref, text }) => (
        <li key={ref.line} data-remedy-line={ref.line}>
          {ref.process !== undefined && (
            <div className="remedy-row" data-part="remedy-process">
              <span className="remedy-row-label">{t('page.remedies.process')}</span>
              <div className="remedy-row-content"><a href={nav.process(ref.process)}>{processName.get(ref.process) ?? ref.process}</a></div>
            </div>
          )}
          <RemedyItem text={text} line={ref.line} anchorPrefix={prefix} problems={ref.problems} idPrefix={`${prefix}${ref.line}`} />
        </li>
      ))}
    </ul>
  );
}

/** The line at the end of a domain's subsection of the defect fixes: how many more of its problems the category items cover, then the category of each as a link to it, in its tab. */
function Covered({ covered }: { covered: NonNullable<RemedyGroup['domains'][number]['covered']> }) {
  const t = useText();
  const nav = useLinks();
  return (
    <p className="remedy-covered" data-part="remedy-covered">
      {t('page.remedies.covered', { count: covered.count })}{' '}
      {covered.items.map((item, at) => {
        const anchor = `remedy-defects-a-${item.line}`;
        return (
          <span key={item.line}>
            {at > 0 && t('page.remedies.problemSeparator')}
            <a href={nav.remedyTab('defects')} data-anchor={anchor} onClick={() => { jumpToAnchor('remedies', anchor); }}>{categoryText(t, item.label)}</a>
          </span>
        );
      })}
    </p>
  );
}

/**
 * The items of one tab (page-remedies.mjs): for the defect fixes first a subsection of the category items, each once; then a
 * subsection (level 3) per business domain in the page's order, with the items of the group that involve it (the defect fixes end
 * each with the line that links to the category items); last a subsection of the items tied to no domain.
 */
function GroupTab({ group }: { group: RemedyGroup }) {
  const t = useText();
  const { domains } = useModel();
  return (
    <article className="page remedy-domains" data-view="chapter" data-chapter="remedies" data-tab={group.id}>
      {group.across.length > 0 && (
        <section className="remedy-domain" data-part="remedy-across">
          <div className="prose"><h3>{t('page.remedies.across')}</h3></div>
          <Items refs={group.across} prefix={`remedy-${group.id}-a-`} />
        </section>
      )}
      {group.domains.map((domain) => (
        <section className="remedy-domain" data-part="remedy-domain" data-domain={domain.id} key={domain.id}>
          <div className="prose"><h3>{domains[domain.id]?.name ?? domain.id}</h3></div>
          <Items refs={domain.items} prefix={`remedy-${group.id}-${domain.id}-`} />
          {domain.covered !== undefined && <Covered covered={domain.covered} />}
        </section>
      ))}
      {group.untied.length > 0 && (
        <section className="remedy-domain" data-part="remedy-untied">
          <div className="prose"><h3>{t('page.remedies.untied')}</h3></div>
          <Items refs={group.untied} prefix={`remedy-${group.id}-u-`} />
        </section>
      )}
    </article>
  );
}

/** The tabs of the page: the groups, then the generated section when it lists problems. The one the address names, else the first. */
function tabsOf(remedy: RemedyDomains): string[] {
  return [...remedy.groups.map((group) => group.id as string), ...(remedy.generated === null ? [] : [UNCOVERED_TAB])];
}

const UNCOVERED_TAB = 'uncovered';

/** The tab bar, a sentence about the selected group, and the selected tab only. */
function Tabs({ tab, generatedPart }: { tab: string | undefined; generatedPart: ReactNode }) {
  const t = useText();
  const nav = useLinks();
  const { remedyDomains } = useModel();
  if (remedyDomains === null) return null;
  const ids = tabsOf(remedyDomains);
  const selected = tab !== undefined && ids.includes(tab) ? tab : ids[0];
  const group = remedyDomains.groups.find((entry) => entry.id === selected);
  const label = (id: string): string => (id === UNCOVERED_TAB ? t('chapter.remedies.uncovered') : t(`page.remedies.group.${id}`));
  const count = (id: string): number => (id === UNCOVERED_TAB ? remedyDomains.generated ?? 0 : remedyDomains.groups.find((entry) => entry.id === id)?.count ?? 0);
  return (
    <>
      <nav className="remedy-tabs" role="tablist" aria-label={t('page.nav.remedies')} data-part="remedy-tabs">
        {ids.map((id) => (
          <a key={id} role="tab" href={nav.remedyTab(id)} aria-selected={id === selected} data-tab={id}>{label(id)}<span className="remedy-tab-count">{count(id)}</span></a>
        ))}
      </nav>
      {group !== undefined && group.id !== 'other' && <p className="muted remedy-note" data-part="remedy-note">{t(`page.remedies.groupNote.${group.id}`)}</p>}
      {group !== undefined ? <GroupTab group={group} /> : generatedPart}
    </>
  );
}

/**
 * The improvement suggestions page: the remedies chapter under a title of the page's own (the chapter's level-1 heading is
 * left out), with the scanning table of contents at the right like any reading page. No previous and next: it is a place
 * of its own, not a step of the reading order. With the items in groups the chapter's own text is only its notices and the generated section; the groups are tabs by measure type (the selected one in the address), one at a time, and the items are laid out by domain inside; else the sections of the processes are folded into one list of links to the process pages.
 */
export function RemediesPage({ data, tab }: { data: PageData; tab?: string }) {
  const t = useText();
  const nav = useLinks();
  const main = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState(true);
  const onPresent = useCallback((present: boolean) => setToc(present), []);
  useNumberedHeadings(main);
  const folded = useMemo(() => new Set((data.processes?.items ?? []).filter((item) => item.remedies !== undefined && item.remedies.length > 0).map((item) => item.id)), [data.processes]);
  const rework = useCallback((text: string) => withoutProcessSections(text, folded), [folded]);
  const byDomain = data.remedyDomains !== null;
  const generated = t('chapter.remedies.uncovered');
  const before = useCallback((text: string) => onlyBeforeSections(text), []);
  const last = useCallback((text: string) => onlyGeneratedSection(text, generated), [generated]);
  const chapter = data.problems.remedies === null ? undefined : data.chapters.find((candidate) => candidate.id === data.problems.remedies);
  return (
    <div className="read" data-view="remedies" data-toc={chapter !== undefined && toc ? 'yes' : 'none'}>
      <div className="read-main" ref={main}>
        <Breadcrumbs trail={[{ label: t('page.nav.overview'), href: nav.home }, { label: t('page.nav.remedies') }]} />
        <h1 className="page-title">{t('page.nav.remedies')}</h1>
        {chapter === undefined
          ? <p className="muted" data-part="no-remedies">{t('page.problems.noRemediesChapter')}</p>
          : (
            <div data-part="remedies">
              {byDomain ? (
                <>
                  <ChapterPage chapter={chapter} omitTitle rework={before} />
                  <Tabs tab={tab} generatedPart={<ChapterPage chapter={chapter} omitTitle rework={last} />} />
                </>
              ) : (
                <>
                  <ProcessSuggestions data={data} />
                  <ChapterPage chapter={chapter} omitTitle rework={rework} />
                </>
              )}
            </div>
          )}
      </div>
      {chapter !== undefined && <Toc root={main} onPresent={onPresent} />}
    </div>
  );
}
