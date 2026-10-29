import { useEffect, useMemo, useRef, useState } from 'react';

import { JUMP_LIMIT, jumpHash, matchJump } from '../lib/jump';
import type { JumpItem } from '../lib/jump';
import type { PageData } from '../lib/types';
import { SearchIcon } from './Icons';
import { PriorityBadge, StatusMark } from './StatusBadge';

/**
 * The quick-jump dialog (design D5): one input and a list of the matching
 * features and findings. The arrow keys move, Enter opens, Esc closes, and the
 * focus goes back to where it was before the dialog opened.
 */
export function QuickJump({ data, onClose, onChoose }: { data: PageData; onClose: () => void; onChoose: (hash: string) => void }) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const result = useMemo(() => matchJump(data.features, data.findings, query), [data.features, data.findings, query]);
  const names = useMemo(() => new Map(data.features.map((feature) => [feature.id, feature.name])), [data.features]);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
      else document.getElementById('main')?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at, result]);

  const choose = (item: JumpItem | undefined) => {
    if (item !== undefined) onChoose(jumpHash(item));
  };
  const count = result.items.length;

  return (
    <div className="jump-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="jump-dialog" role="dialog" aria-modal="true" aria-label="Quick jump" data-jump-dialog>
        <div className="jump-input-row">
          <SearchIcon />
          <input
            ref={inputRef}
            className="jump-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="jump-list"
            aria-activedescendant={count > 0 ? `jump-option-${at}` : undefined}
            aria-label="Feature or finding"
            autoComplete="off"
            spellCheck={false}
            placeholder="Feature or finding: an id, a name, or words of a statement"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); if (count > 0) setAt((at + 1) % count); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); if (count > 0) setAt((at - 1 + count) % count); }
              else if (event.key === 'Enter') { event.preventDefault(); choose(result.items[at]); }
              else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
              else if (event.key === 'Tab') event.preventDefault();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="jump-list" id="jump-list" role="listbox" aria-label="Matches" ref={listRef}>
          {count === 0 && <li className="jump-empty" role="presentation">Nothing matches &ldquo;{query.trim()}&rdquo;.</li>}
          {result.items.map((item, index) => {
            const id = item.type === 'feature' ? item.feature.id : item.finding.id;
            return (
              <li
                key={`${item.type}:${id}`}
                id={`jump-option-${index}`}
                role="option"
                aria-selected={index === at}
                className="jump-item"
                data-jump-type={item.type}
                onMouseMove={() => { if (at !== index) setAt(index); }}
                onClick={() => choose(item)}
              >
                <span className="jump-kind">{item.type === 'feature' ? 'Feature' : 'Finding'}</span>
                <span className="jump-id">{id}</span>
                {item.type === 'feature' ? (
                  <>
                    <span className="jump-title">{item.feature.name}</span>
                    <StatusMark status={item.feature.status} />
                  </>
                ) : (
                  <>
                    <span className="jump-title">{item.finding.statement}</span>
                    <span className="jump-meta"><PriorityBadge value={item.finding.priority} /><span className="jump-owner" title={names.get(item.finding.feature)}>{item.finding.feature}</span></span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <div className="jump-foot" role="status">
          <span>{result.total === 0 ? 'No matches' : result.total > JUMP_LIMIT ? `Showing ${count} of ${result.total} matches` : `${result.total} ${result.total === 1 ? 'match' : 'matches'}`}</span>
          <span className="jump-hints"><kbd>&uarr;</kbd><kbd>&darr;</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
