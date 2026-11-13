import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { Group } from '../lib/groups';
import { jumpToHeading } from '../lib/heading-jump';
import { useLinks } from '../lib/links';
import type { PageItem } from '../lib/pages';
import { searchResults } from '../lib/search';
import type { Result } from '../lib/search';
import type { Pair } from '../lib/strata';
import { useText } from '../lib/text';
import type { SearchItem } from '../lib/types';
import { Mark } from './Mark';

interface Props {
  groups: Group[];
  colours: Record<string, Pair>;
  items: SearchItem[];
  references: PageItem[];
  /** Close the dialog and give the focus back to the element that opened it. */
  onClose: () => void;
  /** Close the dialog because a result was chosen: the focus goes to the page, not back. */
  onDone: () => void;
}

/**
 * The search of the page: a dialog with an input and a list of results (domains, chapters, headings). The arrows move the
 * selection, Enter or a click goes to the result (a heading is scrolled to and focused), Escape or a click on the backdrop closes it.
 */
export function SearchDialog({ groups, colours, items, references, onClose, onDone }: Props) {
  const t = useText();
  const nav = useLinks();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const results = useMemo(
    () => searchResults({ query, groups, items, references, referencesLabel: t('page.nav.references'), domainsLabel: t('page.nav.domains'), systemTitle: t('page.nav.system') }),
    [query, groups, items, references, t],
  );
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
    else window.location.hash = nav.chapter(target.kind === 'chapter' ? target.id : target.chapter);
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
                <span className="search-title">{result.title}</span>
                <small>{result.context}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
