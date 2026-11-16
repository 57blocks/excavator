import { useEffect, useRef, useState } from 'react';

import type { Context } from '../lib/navigation';
import { useLinks } from '../lib/links';
import { useModel } from '../lib/model';
import { hrefOf } from '../lib/pages';
import { ReferenceGroups } from './ReferenceGroups';
import { colourProps } from '../lib/strata';
import type { Pair } from '../lib/strata';
import { useText } from '../lib/text';
import { Mark } from './Mark';

/** Wide screens show the list open; a phone has it closed behind its heading. */
const wideAtStart = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 900px)').matches;

/** Scrolls the side list's own box (never the window) just enough to show the link, and only when it is outside the visible range. */
function revealIn(box: HTMLElement, link: HTMLElement): void {
  const boxRect = box.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  if (boxRect.height === 0 || linkRect.height === 0) return;
  if (linkRect.top < boxRect.top) box.scrollTop += linkRect.top - boxRect.top;
  else if (linkRect.bottom > boxRect.bottom) box.scrollTop += linkRect.bottom - boxRect.bottom;
}

/**
 * The list at the side of a reading page: every group of features, each a fold with its colour and name (all open at the start,
 * the reader can close any), each feature with its problem count; or the references. The current page has a bar in the group's edge colour.
 * Below 900px the whole list is a `details` whose summary is the current group's name, open on a wide screen only.
 */
export function SideList({ context, current, colour }: { context: Context; current: string; colour: Pair | null }) {
  const t = useText();
  const nav = useLinks();
  const model = useModel();
  const [open, setOpen] = useState(wideAtStart);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const box = useRef<HTMLElement>(null);
  const name = context.kind === 'group' ? context.group.name : t('page.nav.references');
  useEffect(() => {
    const link = box.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (box.current && link) revealIn(box.current, link);
  }, [current]);
  const mark = context.kind === 'group' && colour !== null ? <Mark colour={colour} /> : null;
  return (
    <nav className="side" ref={box} aria-label={context.kind === 'group' ? t('page.nav.domains') : name} data-side={context.kind}>
      {context.kind === 'references' && <h2 className="side-name">{name}</h2>}
      <details open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary>{mark}{name}</summary>
        {context.kind === 'references' ? <ReferenceGroups groups={context.groups} as="list" current={current} /> : (
          <div className="side-groups">
            {context.groups.map((group) => {
              const pair = model.colours[group.id] ?? (group.id === context.group.id ? colour : null);
              const here = group.id === context.group.id;
              return (
                <details key={group.id} className="side-group" data-group={group.id} open={!closed.has(group.id)} onToggle={(event) => { const isOpen = (event.currentTarget as HTMLDetailsElement).open; setClosed((was) => { if (was.has(group.id) === !isOpen) return was; const next = new Set(was); if (isOpen) next.delete(group.id); else next.add(group.id); return next; }); }} {...(pair === null ? {} : colourProps(pair))}>
                  <summary>{pair !== null && <Mark colour={pair} />}<span className="side-group-name">{group.name}</span></summary>
                  <ul>
                    {group.features.map((item) => (
                      <li key={item.key}>
                        <a href={hrefOf(item, nav)} data-page={item.key} aria-current={here && item.key === current ? 'page' : undefined}>
                          <span className="side-title">{item.title}</span>
                          <span className="side-count" data-part="problem-count">{model.problemCount[item.block] ?? 0}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}
      </details>
    </nav>
  );
}
