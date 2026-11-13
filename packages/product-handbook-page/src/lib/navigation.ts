import { groupOfFeature, groupsOf, referencesOf } from './groups';
import type { Group } from './groups';
import { bodyOf, bodyOfItem, pageOf, pagesOf, routeKey } from './pages';
import type { PageItem } from './pages';
import { routeHash } from './route';
import type { Route } from './route';
import type { PageData, View } from './types';

/** The view a route is shown in, or null when the page does not have it (a view it was not built with, a page the view does not have, a domain that is not there). */
export function viewOf(data: PageData, route: Route, coverageTitle: string): View | null {
  const view = route.view ?? data.views[0];
  if (!data.views.includes(view)) return null;
  const body = bodyOf(route);
  if (body.name === 'home') return view;
  if (body.name === 'domain') return groupsOf(data).some((group) => group.id === body.id) ? view : null;
  return pageOf(pagesOf(data, view, coverageTitle), route) === undefined ? null : view;
}

/** The fragment that shows the same page in `view`; the home page when that view does not have the page (the data page in the product view). */
export function switchTarget(data: PageData, route: Route, view: View, coverageTitle: string): string {
  const body = bodyOf(route);
  if (body.name === 'domain') return routeHash(groupsOf(data).some((group) => group.id === body.id) ? body : { name: 'home' }, view);
  const key = routeKey(body);
  const keep = key !== null && pagesOf(data, view, coverageTitle).some((item) => item.key === key);
  const pages = pagesOf(data, view, coverageTitle);
  const target = keep ? bodyOfItem(pages.find((item) => item.key === key) as PageItem) : { name: 'home' as const };
  return routeHash(target, view);
}

/** What a reading page sits in: its group (a feature chapter) or the references (every other page), with the pages of the side list in order. */
export type Context =
  | { kind: 'group'; group: Group; items: PageItem[] }
  | { kind: 'references'; items: PageItem[] };

/** The context of the page `key` in `view`. */
export function contextOf(data: PageData, view: View, coverageTitle: string, key: string): Context {
  const group = groupOfFeature(groupsOf(data), key.startsWith('chapter:') ? key.slice('chapter:'.length) : '');
  if (group !== undefined) return { kind: 'group', group, items: group.features };
  return { kind: 'references', items: referencesOf(data, view, coverageTitle) };
}

/** The pages before and after `key` in the list of pages, or undefined at an end. */
export function neighbours(items: PageItem[], key: string): { previous?: PageItem; next?: PageItem } {
  const at = items.findIndex((item) => item.key === key);
  if (at < 0) return {};
  return { previous: at > 0 ? items[at - 1] : undefined, next: at < items.length - 1 ? items[at + 1] : undefined };
}
