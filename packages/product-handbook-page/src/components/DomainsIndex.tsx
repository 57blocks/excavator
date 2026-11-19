import type { Group } from '../lib/groups';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { InlineMarkdown } from './InlineMarkdown';
import { Mark } from './Mark';

/**
 * The domains chapter page when the list of domains is usable: the domains in the order of the left list, each with its colour
 * mark, its name as a link to its page and its intro (the line the domain page shows). The features, the hand-overs and the main
 * line are on the domain pages, so they are not repeated here.
 */
export function DomainsIndex({ title, groups }: { title: string; groups: Group[] }) {
  const nav = useLinks();
  const view = useView();
  const { colours, domains } = useModel();
  return (
    <article className="page domains-index" data-chapter="domains" data-part="domains-index">
      <h1 className="page-title">{title}</h1>
      <ul className="dom-index">
        {groups.map((group) => {
          const intro = domains[group.id]?.intro[view] ?? '';
          return (
            <li key={group.id} data-domain={group.id}>
              <a className="dom-index-name" href={nav.domain(group.id)}><Mark colour={colours[group.id]} />{group.name}</a>
              {intro !== '' && <p className="dom-index-intro"><InlineMarkdown source={intro} /></p>}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
