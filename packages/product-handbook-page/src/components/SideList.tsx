import { useState } from 'react';

import type { Context } from '../lib/navigation';
import { useLinks } from '../lib/links';
import { hrefOf } from '../lib/pages';
import { colourProps } from '../lib/strata';
import type { Pair } from '../lib/strata';
import { useText } from '../lib/text';
import { Mark } from './Mark';

/** Wide screens show the list open; a phone has it closed behind its heading. */
const wideAtStart = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 900px)').matches;

/**
 * The list at the side of a reading page: the pages of the current group (with its colour and its name, which links to the
 * domain page) or the references. The current page has a bar in the group's edge colour. Below 900px it is a `details`
 * whose summary is the group's name, open on a wide screen only.
 */
export function SideList({ context, current, colour }: { context: Context; current: string; colour: Pair | null }) {
  const t = useText();
  const nav = useLinks();
  const [open, setOpen] = useState(wideAtStart);
  const name = context.kind === 'group' ? context.group.name : t('page.nav.references');
  const mark = context.kind === 'group' && colour !== null ? <Mark colour={colour} /> : null;
  const dom = context.kind === 'group' && colour !== null ? colourProps(colour) : {};
  return (
    <nav className="side" aria-label={name} data-side={context.kind} {...dom}>
      <h2 className="side-name">{mark}{context.kind === 'group' ? <a href={nav.domain(context.group.id)}>{name}</a> : name}</h2>
      <details open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary>{mark}{name}</summary>
        <ul>
          {context.items.map((item) => (
            <li key={item.key}><a href={hrefOf(item, nav)} data-page={item.key} aria-current={item.key === current ? 'page' : undefined}>{item.title}</a></li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
