import { routeHash } from './route';
import type { Route, RouteBody } from './route';
import type { BlockKind, OutlineBlock, PageData, View } from './types';

/** One page of the handbook as the navigation lists it: its block, its kind, its title and the key of its route. */
export interface PageItem { block: string; kind: BlockKind | 'coverage'; title: string; key: string }

export const COVERAGE_BLOCK = 'coverage';

/** The route key of a page: `chapter:<id>` for a chapter, the page's name for the others. */
export function itemKey(kind: PageItem['kind'], block: string): string {
  return kind === 'chapter' ? `chapter:${block}` : kind;
}

/** The page an outline block is. */
export function itemOf(block: OutlineBlock): PageItem {
  return { block: block.block, kind: block.kind, title: block.title, key: itemKey(block.kind, block.block) };
}

/** The key of the page a route shows; null for the home route, a domain route and an address that names no page. */
export function routeKey(route: RouteBody): string | null {
  switch (route.name) {
    case 'chapter': return `chapter:${route.id}`;
    case 'data': case 'dictionaries': case 'history': case 'coverage': return route.name;
    case 'home': case 'domain': case 'not-found': return null;
  }
}

/** The route of a page. */
export function bodyOfItem(item: PageItem): RouteBody {
  switch (item.kind) {
    case 'chapter': return { name: 'chapter', id: item.block };
    case 'data': case 'dictionaries': case 'history': case 'coverage': return { name: item.kind };
  }
}

/** Whether a block is shown in `view`: the technical blocks (data, dictionaries) are not in the product view. */
export function inView(block: OutlineBlock, view: View): boolean {
  return !((block.kind === 'data' || block.kind === 'dictionaries') && view !== 'technical');
}

/** The pages of the handbook in the order of its outline for `view`, the coverage page last. */
export function pagesOf(data: PageData, view: View, coverageTitle: string): PageItem[] {
  const out: PageItem[] = [];
  for (const part of data.outline.parts) {
    for (const block of part.blocks) if (inView(block, view)) out.push(itemOf(block));
  }
  out.push({ block: COVERAGE_BLOCK, kind: 'coverage', title: coverageTitle, key: 'coverage' });
  return out;
}

/** The route without its view prefix. */
export function bodyOf(route: Route): RouteBody {
  const { view: _view, ...body } = route;
  return body as RouteBody;
}

/** The page a route shows in the list of pages, or undefined when it shows none (the home route, a domain, an address that names no page). */
export function pageOf(pages: PageItem[], route: Route): PageItem | undefined {
  const key = routeKey(bodyOf(route));
  return key === null ? undefined : pages.find((item) => item.key === key);
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
