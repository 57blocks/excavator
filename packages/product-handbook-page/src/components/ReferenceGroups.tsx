import { useLinks } from '../lib/links';
import type { ReferenceGroup } from '../lib/groups';
import { hrefOf } from '../lib/pages';

/**
 * The reference pages in their groups, as lists: the group's title as small secondary text, the pages as links. Groups are told
 * apart by rules (see the stylesheet), not boxes. `current` is the key of the page the reader is on.
 */
export function ReferenceGroups({ groups, current, listClass }: { groups: ReferenceGroup[]; current?: string; listClass?: string }) {
  const nav = useLinks();
  return (
    <>
      {groups.map((group, at) => (
        <div key={at} className="ref-group" data-ref-group={group.title ?? ''}>
          {group.title !== null && <span className="ref-group-title">{group.title}</span>}
          <ul className={listClass}>
            {group.items.map((item) => <li key={item.key}><a href={hrefOf(item, nav)} data-page={item.key} aria-current={item.key === current ? 'page' : undefined}>{item.title}</a></li>)}
          </ul>
        </div>
      ))}
    </>
  );
}
