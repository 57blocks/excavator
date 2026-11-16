import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { Context } from '../lib/navigation';
import { stepsOf } from '../lib/navigation';
import type { PageItem } from '../lib/pages';
import type { Crumb } from './Breadcrumbs';
import { Breadcrumbs } from './Breadcrumbs';
import { PrevNext } from './PrevNext';
import { SideList } from './SideList';
import { Toc } from './Toc';
import type { Pair } from '../lib/strata';

interface Props {
  item: PageItem;
  context: Context;
  colour: Pair | null;
  trail: Crumb[];
  /** The data, dictionaries and history pages hold wide tables: they use the full width and have no table of contents. */
  wide: boolean;
  /** 'scan' (default): the table of contents scans the article's headings; 'own': the page draws its own list at the right; 'none': no list. */
  toc?: 'scan' | 'none' | 'own';
  children: ReactNode;
}

/** A reading page: the side list, the breadcrumbs, the page, previous and next, and (for prose) the table of contents. */
export function Reading({ item, context, colour, trail, wide, toc: kind = 'scan', children }: Props) {
  const main = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState(true);
  const onPresent = useCallback((present: boolean) => setToc(present), []);
  const { previous, next } = stepsOf(context, item.key);
  return (
    <div className="read" data-wide={wide ? 'true' : undefined} data-toc={wide || kind === 'none' ? 'none' : kind === 'own' ? 'own' : toc ? 'yes' : 'none'}>
      <SideList context={context} current={item.key} colour={colour} />
      <div className="read-main" ref={main}>
        <Breadcrumbs trail={trail} />
        {children}
        <PrevNext previous={previous} next={next} />
      </div>
      {!wide && kind === 'scan' && <Toc key={item.key} root={main} onPresent={onPresent} />}
    </div>
  );
}
