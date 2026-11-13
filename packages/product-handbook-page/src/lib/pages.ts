import { routeHash } from './route';
import type { Route, RouteBody } from './route';
import type { BlockKind, PageData, View } from './types';

/**
 * One page of the handbook as the navigation lists it: the part it is in (the index in the outline; null for the coverage
 * page, which is always last and in no part), its block, its kind, its title and the key of its route.
 */
export interface PageItem { part: number | null; partTitle: string; block: string; kind: BlockKind | 'coverage'; title: string; key: string }

export const COVERAGE_BLOCK = 'coverage';

/** The route key of a page: `chapter:<id>` for a chapter, the page's name for the others. */
export function itemKey(kind: PageItem['kind'], block: string): string {
  return kind === 'chapter' ? `chapter:${block}` : kind;
}

/** The key of the page a route shows; null for the home route (the first page) and for an address that names no page. */
export function routeKey(route: RouteBody): string | null {
  switch (route.name) {
    case 'chapter': return `chapter:${route.id}`;
    case 'data': case 'dictionaries': case 'history': case 'coverage': return route.name;
    case 'home': case 'not-found': return null;
  }
}

/** The route of a page. */
export function bodyOfItem(item: PageItem): RouteBody {
  switch (item.kind) {
    case 'chapter': return { name: 'chapter', id: item.block };
    case 'data': case 'dictionaries': case 'history': case 'coverage': return { name: item.kind };
  }
}

/** The pages of the handbook in the order of its outline for `view`, the coverage page last; the technical blocks (data, dictionaries) are skipped in the product view. */
export function pagesOf(data: PageData, view: View, coverageTitle: string): PageItem[] {
  const out: PageItem[] = [];
  data.outline.parts.forEach((part, at) => {
    for (const item of part.blocks) {
      if ((item.kind === 'data' || item.kind === 'dictionaries') && view !== 'technical') continue;
      out.push({ part: at, partTitle: part.title, block: item.block, kind: item.kind, title: item.title, key: itemKey(item.kind, item.block) });
    }
  });
  out.push({ part: null, partTitle: coverageTitle, block: COVERAGE_BLOCK, kind: 'coverage', title: coverageTitle, key: 'coverage' });
  return out;
}

/** The route without its view prefix. */
export function bodyOf(route: Route): RouteBody {
  const { view: _view, ...body } = route;
  return body as RouteBody;
}

/** The page a route shows in `view` (the first page for the home route), or undefined when the view does not have it. */
export function pageOf(pages: PageItem[], route: Route): PageItem | undefined {
  const key = routeKey(bodyOf(route));
  if (bodyOf(route).name === 'home') return pages[0];
  return key === null ? undefined : pages.find((item) => item.key === key);
}

/** The view a route is shown in, or null when the page does not have it (a view it was not built with, or a page the view does not have). */
export function viewOf(data: PageData, route: Route, coverageTitle: string): View | null {
  const view = route.view ?? data.views[0];
  if (!data.views.includes(view)) return null;
  return pageOf(pagesOf(data, view, coverageTitle), route) === undefined ? null : view;
}

/**
 * The fragment that shows the same page in `view`; the first page of that view when it does not have the page (the data
 * page in the product view).
 */
export function switchTarget(data: PageData, route: Route, view: View, coverageTitle: string): string {
  const pages = pagesOf(data, view, coverageTitle);
  const body = bodyOf(route);
  const key = routeKey(body);
  const keep = key !== null && pages.some((item) => item.key === key);
  const target = keep ? body : bodyOfItem(pages[0]);
  return routeHash(target, view);
}

/** The address of a page, in the view the links were made for. */
export function hrefOf(item: PageItem, nav: { chapter: (id: string) => string; data: string; dictionaries: string; history: string; coverage: string }): string {
  switch (item.kind) {
    case 'chapter': return nav.chapter(item.block);
    case 'data': return nav.data;
    case 'dictionaries': return nav.dictionaries;
    case 'history': return nav.history;
    case 'coverage': return nav.coverage;
  }
}
