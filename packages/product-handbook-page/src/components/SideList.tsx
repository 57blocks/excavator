import { useEffect, useRef, useState } from 'react';

import type { Group, ReferenceGroup } from '../lib/groups';
import { useLinks } from '../lib/links';
import { useModel } from '../lib/model';
import { hrefOf } from '../lib/pages';
import { colourProps } from '../lib/strata';
import { useText } from '../lib/text';
import { Mark } from './Mark';
import { ReferenceGroups } from './ReferenceGroups';

/** The two states of the list: `global` (overview, problems, system architecture, the other pages) and `domain` (back to the overview, every domain with its features). */
export type SideMode = 'global' | 'domain';

/** The place the reader is at, as the list marks it: a page that is no entry of the list (the not-found page) is `none`; a feature page carries its key and the id of its domain. */
export type SidePlace =
  | { kind: 'home' | 'problems' | 'architecture' | 'none' }
  | { kind: 'domain'; id: string }
  | { kind: 'page'; key: string; group: string | null };

interface BodyProps {
  mode: SideMode;
  place: SidePlace;
  groups: Group[];
  references: ReferenceGroup[];
  /** Whether the list has the system architecture entry (technical view with an architecture text). */
  architecture: boolean;
}

/** Scrolls the side list's own box (never the window) just enough to show the link, and only when it is outside the visible range. */
function revealIn(box: HTMLElement, link: HTMLElement): void {
  const boxRect = box.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  if (boxRect.height === 0 || linkRect.height === 0) return;
  if (linkRect.top < boxRect.top) box.scrollTop += linkRect.top - boxRect.top;
  else if (linkRect.bottom > boxRect.bottom) box.scrollTop += linkRect.bottom - boxRect.bottom;
}

const here = (on: boolean): 'page' | undefined => (on ? 'page' : undefined);

/** The global state: the overview, the problems, the system architecture (when the view has it), then the pages of the reference groups. */
function GlobalList({ place, references, architecture }: Pick<BodyProps, 'place' | 'references' | 'architecture'>) {
  const t = useText();
  const nav = useLinks();
  return (
    <>
      <ul className="side-top">
        <li><a href={nav.home} data-nav="overview" aria-current={here(place.kind === 'home')}>{t('page.nav.overview')}</a></li>
        <li><a href={nav.problems()} data-nav="problems" aria-current={here(place.kind === 'problems')}>{t('page.nav.problems')}</a></li>
        {architecture && <li><a href={nav.architecture} data-nav="architecture" aria-current={here(place.kind === 'architecture')}>{t('page.nav.architecture')}</a></li>}
      </ul>
      <ReferenceGroups groups={references} current={place.kind === 'page' ? place.key : undefined} />
    </>
  );
}

/** The domain state: a link back to the overview, then every domain as a fold (all open at the start, the reader can close any) with its features and their problem counts. */
function DomainList({ place, groups }: Pick<BodyProps, 'place' | 'groups'>) {
  const t = useText();
  const nav = useLinks();
  const model = useModel();
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <>
      <a className="side-back" data-part="side-back" href={nav.home}>{t('page.nav.overview')}</a>
      <div className="side-groups">
        {groups.map((group) => {
          const pair = model.colours[group.id] ?? null;
          const inGroup = place.kind === 'page' && place.group === group.id;
          return (
            <details key={group.id} className="side-group" data-group={group.id} open={!closed.has(group.id)} onToggle={(event) => { const isOpen = (event.currentTarget as HTMLDetailsElement).open; setClosed((was) => { if (was.has(group.id) === !isOpen) return was; const next = new Set(was); if (isOpen) next.delete(group.id); else next.add(group.id); return next; }); }} {...(pair === null ? {} : colourProps(pair))}>
              <summary>
                {pair !== null && <Mark colour={pair} />}
                <a className="side-group-name" href={nav.domain(group.id)} data-group-link={group.id} aria-current={here(place.kind === 'domain' && place.id === group.id)}>{group.name}</a>
              </summary>
              <ul>
                {group.features.map((item) => (
                  <li key={item.key}>
                    <a href={hrefOf(item, nav)} data-page={item.key} aria-current={here(inGroup && place.kind === 'page' && item.key === place.key)}>
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
    </>
  );
}

/** The body of the list in its mode: the left list and the phone's menu show this same content. */
export function SideBody(props: BodyProps) {
  return <div className="side-body">{props.mode === 'domain' ? <DomainList place={props.place} groups={props.groups} /> : <GlobalList place={props.place} references={props.references} architecture={props.architecture} />}</div>;
}

/**
 * The list at the left of every page, sticky and scrolling in its own box (below 900px it is not shown: the menu has the same
 * list). In the `global` state it lists the overview, the problems, the system architecture (technical view) and the other pages
 * by the parts of the outline; in the `domain` state a link back to the overview and every domain with its features. The page
 * the reader is on has `aria-current`; the list scrolls to it when it changes.
 */
export function SideList(props: BodyProps) {
  const t = useText();
  const box = useRef<HTMLElement>(null);
  const placeText = JSON.stringify(props.place);
  useEffect(() => {
    const link = box.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (box.current && link) revealIn(box.current, link);
  }, [placeText, props.mode]);
  return (
    <nav className="side" ref={box} aria-label={props.mode === 'domain' ? t('page.nav.domains') : t('page.nav.label')} data-side={props.mode}>
      <SideBody {...props} />
    </nav>
  );
}
