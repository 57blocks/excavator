import { createContext, useContext } from 'react';

import type { Outline } from './types';

/** The block ids whose pages are chapters of their own: also the names of their routes. */
const BLOCK_ROUTES = new Set(['overview', 'business', 'architecture', 'data', 'roles-matrix', 'applications-matrix', 'dictionaries', 'notifications', 'jobs', 'topics', 'history', 'findings', 'recommendations', 'open-questions', 'glossary', 'sources']);

export const isBlockRoute = (name: string): boolean => BLOCK_ROUTES.has(name);

/** The title the outline gives the chapter that holds a block, or undefined when the outline places it in no chapter. */
export function chapterTitle(outline: Outline, block: string): string | undefined {
  for (const part of outline.parts) {
    for (const chapter of part.chapters) if (chapter.block === block) return chapter.title;
  }
  return undefined;
}

/** What the pages read the outline through: the titles of the chapters and, on a block's page, the title of its own chapter. */
export interface ChapterTitles { outline: Outline | null; current: string | null }

export const ChapterTitleContext = createContext<ChapterTitles>({ outline: null, current: null });

/** The title of the chapter of `block` (the fixed `fallback` when the outline holds none). */
export function useBlockTitle(block: string, fallback: string): string {
  const { outline } = useContext(ChapterTitleContext);
  return (outline === null ? undefined : chapterTitle(outline, block)) ?? fallback;
}

/** The page's own heading: the title of the chapter the route is, or the fixed `fallback` on a page that is not a chapter. */
export function PageTitle({ fallback }: { fallback: string }) {
  const { current } = useContext(ChapterTitleContext);
  return <h1 className="page-title">{current ?? fallback}</h1>;
}
