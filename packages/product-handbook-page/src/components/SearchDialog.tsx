import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';

import type { Group } from '../lib/groups';
import { assembleChapterTexts, chapterUnitKey, LoaderContext } from '../lib/chunks';
import { jumpToHeading } from '../lib/heading-jump';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import type { PageItem } from '../lib/pages';
import { MAX_RESULTS, MIN_TEXT_QUERY, searchAll } from '../lib/search';
import type { Result, TextSource } from '../lib/search';
import type { Pair } from '../lib/strata';
import { useText } from '../lib/text';
import type { ChapterData, SearchItem } from '../lib/types';
import { Mark } from './Mark';

interface Props {
  groups: Group[];
  colours: Record<string, Pair>;
  items: SearchItem[];
  /** The chapters of the page; their text in the current view is searched too. */
  chapters: ChapterData[];
  references: PageItem[];
  /** Close the dialog and give the focus back to the element that opened it. */
  onClose: () => void;
  /** Close the dialog because a result was chosen: the focus goes to the page, not back. */
  onDone: () => void;
}

/**
 * The search of the page: a dialog with an input and a list of results (domains, chapters, headings, then the sections whose
 * text matches, design D25). The arrows move the selection, Enter or a click goes to the result (a heading is scrolled to and
 * focused), Escape or a click on the backdrop closes it. In a page with part files it loads the chapters when it opens; a
 * chapter not loaded yet, or whose file is missing, is not matched, and a line under the list says how many there are.
 */
export function SearchDialog({ groups, colours, items, chapters, references, onClose, onDone }: Props) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const loader = useContext(LoaderContext);
  const { map: domainsIndex, remedyDomains } = useModel();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const searched = useMemo(() => {
    const ids = new Set(items.filter((item) => item.kind === 'chapter' && item.chapter !== null).map((item) => item.chapter as string));
    // The text of the remedies chapter is laid out by domain on its page, so its headings are not the ones its text has: it is found by its headings.
    return chapters.filter((chapter) => ids.has(chapter.id) && !(chapter.id === 'remedies' && remedyDomains !== null));
  }, [items, chapters, remedyDomains]);
  // The states of the chapters' units as one string, so that the sources are worked out again only when one of them changes.
  const statesKey = (): string => searched.map((chapter) => loader.state(chapterUnitKey(chapter.id)).status).join(',');
  const states = useSyncExternalStore(loader.subscribe, statesKey, statesKey);
  useEffect(() => { for (const chapter of searched) loader.load(chapterUnitKey(chapter.id)); }, [loader, searched]);
  const { sources, unloaded } = useMemo(() => {
    const list: TextSource[] = [];
    let missing = 0;
    for (const chapter of searched) {
      const state = loader.state(chapterUnitKey(chapter.id));
      const texts = state.status === 'core' ? chapter.texts : state.status === 'ready' ? assembleChapterTexts(state.pieces) : null;
      const text = texts?.[view];
      if (typeof text === 'string') list.push({ chapter: chapter.id, text });
      else if (texts === null) missing += 1;
    }
    return { sources: list, unloaded: missing };
    // `states` changes whenever a unit's state does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, loader, view, states]);
  const { results, total } = useMemo(
    () => searchAll({ query, groups, items, references, sources, domainsLabel: t('page.nav.domains'), domainsIndex, systemTitle: t('page.nav.system') }),
    [query, groups, items, references, sources, domainsIndex, t],
  );
  const textQuery = [...query.trim()].length >= MIN_TEXT_QUERY;
  const at = Math.min(selected, Math.max(0, results.length - 1));

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const option = list.current?.children[at] as HTMLElement | undefined;
    option?.scrollIntoView?.({ block: 'nearest' });
  }, [at, results]);

  const go = (result: Result | undefined): void => {
    if (result === undefined) return;
    const { target } = result;
    onDone();
    if (target.kind === 'domain') window.location.hash = nav.domain(target.id);
    else if (target.kind === 'process') window.location.hash = nav.process(target.id);
    else if (target.kind === 'problem') window.location.hash = nav.problems({ row: target.id });
    else {
      // The remedies chapter is the improvement suggestions page, not a chapter page.
      const chapter = target.kind === 'chapter' ? target.id : target.chapter;
      window.location.hash = chapter === 'remedies' ? nav.remedies : nav.chapter(chapter);
    }
    if (target.kind === 'heading') jumpToHeading(target.chapter, target.heading);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(Math.min(results.length - 1, at + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(0, at - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); go(results[at]); }
  };

  return (
    <div className="search" data-part="search" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={onKey}>
      <div className="search-box" role="dialog" aria-modal="true" aria-label={t('page.search.title')}>
        <input
          ref={input}
          type="search"
          value={query}
          placeholder={t('page.search.placeholder')}
          aria-label={t('page.search.title')}
          autoComplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={results.length > 0 ? `search-option-${at}` : undefined}
          onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
        />
        {results.length === 0 ? <p className="none" role="status">{t('page.search.none')}</p> : (
          <ul id="search-results" role="listbox" aria-label={t('page.search.results')} ref={list}>
            {results.map((result, index) => (
              <li key={result.key} id={`search-option-${index}`} role="option" aria-selected={index === at} data-result={result.key} onClick={() => go(result)} onMouseMove={() => { if (index !== at) setSelected(index); }}>
                {result.domain !== null && colours[result.domain] !== undefined && <Mark colour={colours[result.domain]} />}
                {result.snippet === undefined ? <span className="search-title">{result.title}</span> : (
                  <span className="search-title search-text">{result.snippet.before}<mark>{result.snippet.match}</mark>{result.snippet.after}</span>
                )}
                {result.context !== '' && <small>{result.context}{result.count !== undefined && result.count > 1 ? ` (${result.count})` : ''}</small>}
              </li>
            ))}
          </ul>
        )}
        {total > MAX_RESULTS && <p className="search-note" role="status">{t('page.search.more', { shown: MAX_RESULTS, total })}</p>}
        {textQuery && unloaded > 0 && <p className="search-note" role="status">{t('page.search.partial', { count: unloaded })}</p>}
      </div>
    </div>
  );
}
