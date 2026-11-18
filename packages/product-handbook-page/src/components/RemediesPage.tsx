import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useLinks } from '../lib/links';
import { onlyBeforeSections, onlyGeneratedSection, withoutProcessSections } from '../lib/remedy-fold';
import { useModel } from '../lib/model';
import { useText } from '../lib/text';
import { numberHeadings } from '../lib/toc';
import type { PageData, RemedyRef } from '../lib/types';
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

/** The items of one place of the page: each in plain text with the problem lines of this place, its id made from `prefix` and its line. */
function Items({ refs, prefix }: { refs: RemedyRef[]; prefix: string }) {
  const view = useView();
  const { remedyDomains } = useModel();
  const texts = new Map((remedyDomains?.items ?? []).map((item) => [item.line, item.texts[view]]));
  const shown = refs.flatMap((ref) => { const text = texts.get(ref.line); return text === undefined ? [] : [{ ref, text }]; });
  return (
    <ul className="proc-rows">
      {shown.map(({ ref, text }) => (
        <li key={ref.line} data-remedy-line={ref.line}>
          <RemedyItem text={text} line={ref.line} anchorPrefix={prefix} problems={ref.problems} idPrefix={`${prefix}${ref.line}`} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The items of the chapter under the business domains (page-remedies.mjs): for each domain its name, then its processes (the process's
 * name as a link to its page) with their items, then its fixed sections of the chapter, each under its own heading; last the items
 * tied to no domain.
 */
function DomainSections() {
  const t = useText();
  const nav = useLinks();
  const { remedyDomains, domains, processes } = useModel();
  if (remedyDomains === null) return null;
  const processName = new Map((processes?.items ?? []).map((item) => [item.id, item.name]));
  return (
    <article className="page remedy-domains" data-view="chapter" data-chapter="remedies">
      {remedyDomains.domains.map((domain) => (
        <section className="remedy-domain" data-part="remedy-domain" data-domain={domain.id} key={domain.id}>
          <div className="prose"><h2>{domains[domain.id]?.name ?? domain.id}</h2></div>
          {domain.processes.map((process) => (
            <div className="remedy-place" data-process={process.id} key={process.id}>
              <div className="prose"><h3><a href={nav.process(process.id)}>{processName.get(process.id) ?? process.id}</a></h3></div>
              <Items refs={process.items} prefix={`remedy-${domain.id}-`} />
            </div>
          ))}
          {domain.sections.map((section) => (
            <div className="remedy-place" data-section={section.heading} key={section.heading}>
              <div className="prose"><h3>{section.heading}</h3></div>
              <Items refs={section.items} prefix={`remedy-${domain.id}-`} />
            </div>
          ))}
        </section>
      ))}
      {remedyDomains.untied.length > 0 && (
        <section className="remedy-domain" data-part="remedy-untied">
          <div className="prose"><h2>{t('page.remedies.untied')}</h2></div>
          <Items refs={remedyDomains.untied} prefix="remedy-u-" />
        </section>
      )}
    </article>
  );
}

/**
 * The improvement suggestions page: the remedies chapter under a title of the page's own (the chapter's level-1 heading is
 * left out), with the scanning table of contents at the right like any reading page. No previous and next: it is a place
 * of its own, not a step of the reading order. With the items placed under the business domains the chapter's own text is only its notices and the generated section, and the items are laid out by domain; else the sections of the processes are folded into one list of links to the process pages.
 */
export function RemediesPage({ data }: { data: PageData }) {
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
                  <DomainSections />
                  <ChapterPage chapter={chapter} omitTitle rework={last} />
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
