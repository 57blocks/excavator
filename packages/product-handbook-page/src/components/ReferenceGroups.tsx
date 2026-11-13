import { useLinks } from '../lib/links';
import type { ReferenceGroup } from '../lib/groups';
import { hrefOf } from '../lib/pages';

/**
 * The reference pages in their groups: the group's title as small secondary text, the pages as links (`links`, bare anchors,
 * for the popover and the phone menu) or as lists (`list`). Groups are told apart by rules (see the stylesheet), not boxes.
 * `current` is the key of the page the reader is on.
 */
export function ReferenceGroups({ groups, as, current, listClass }: { groups: ReferenceGroup[]; as: 'links' | 'list'; current?: string; listClass?: string }) {
  const nav = useLinks();
  return (
    <>
      {groups.map((group, at) => (
        <div key={at} className="ref-group" data-ref-group={group.title ?? ''}>
          {group.title !== null && <span className="ref-group-title">{group.title}</span>}
          {as === 'links'
            ? group.items.map((item) => <a key={item.key} href={hrefOf(item, nav)} data-page={item.key}>{item.title}</a>)
            : (
              <ul className={listClass}>
                {group.items.map((item) => <li key={item.key}><a href={hrefOf(item, nav)} data-page={item.key} aria-current={item.key === current ? 'page' : undefined}>{item.title}</a></li>)}
              </ul>
            )}
        </div>
      ))}
    </>
  );
}
