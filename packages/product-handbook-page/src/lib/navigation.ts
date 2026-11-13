import { flatReferences, groupOfFeature, groupsOf, referencesOf } from './groups';
import type { Group, ReferenceGroup } from './groups';
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

/**
 * What a reading page sits in: its group (a feature chapter) or the references (every other page), with the pages of the side
 * list in order. `order` is the order previous and next follow: the features of every group in the groups' order (a group
 * feature chapter is listed once, in the first group that has it), or the references flattened.
 */
export type Context =
  | { kind: 'group'; group: Group; items: PageItem[]; order: { item: PageItem; group: Group }[] }
  | { kind: 'references'; groups: ReferenceGroup[]; items: PageItem[]; order: { item: PageItem; group: null }[] };

/** The context of the page `key` in `view`. */
export function contextOf(data: PageData, view: View, coverageTitle: string, systemTitle: string, key: string): Context {
  const groups = groupsOf(data);
  const group = groupOfFeature(groups, key.startsWith('chapter:') ? key.slice('chapter:'.length) : '');
  if (group !== undefined) {
    const seen = new Set<string>();
    const order = groups.flatMap((one) => one.features.filter((item) => !seen.has(item.key) && seen.add(item.key)).map((item) => ({ item, group: one })));
    return { kind: 'group', group, items: group.features, order };
  }
  const references = referencesOf(data, view, coverageTitle, systemTitle);
  const items = flatReferences(references);
  return { kind: 'references', groups: references, items, order: items.map((item) => ({ item, group: null })) };
}

/** A step to the previous or the next page; `domain` is the name of the target's group when it is not the group of the page the reader is on. */
export interface Step { item: PageItem; domain: string | null }

/** The previous and the next page of `key` in the context's order, each marked with its domain when it crosses into another one. */
export function stepsOf(context: Context, key: string): { previous?: Step; next?: Step } {
  const at = context.order.findIndex((entry) => entry.item.key === key);
  if (at < 0) return {};
  const here = context.order[at].group;
  const step = (entry: { item: PageItem; group: Group | null } | undefined): Step | undefined => (entry === undefined ? undefined : { item: entry.item, domain: entry.group !== null && entry.group.id !== here?.id ? entry.group.name : null });
  return { previous: step(context.order[at - 1]), next: step(context.order[at + 1]) };
}

/** The pages before and after `key` in the list of pages, or undefined at an end. */
export function neighbours(items: PageItem[], key: string): { previous?: PageItem; next?: PageItem } {
  const at = items.findIndex((item) => item.key === key);
  if (at < 0) return {};
  return { previous: at > 0 ? items[at - 1] : undefined, next: at < items.length - 1 ? items[at + 1] : undefined };
}
