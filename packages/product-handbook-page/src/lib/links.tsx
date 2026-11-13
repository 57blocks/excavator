import { createContext, useContext } from 'react';

import { routeHash } from './route';
import type { View } from './types';

/** The address of each page, in the view the reader is in: with the view in front when the page has two views, without it when it has one. */
export interface Links {
  home: string;
  coverage: string;
  data: string;
  dictionaries: string;
  history: string;
  chapter: (id: string) => string;
  domain: (id: string) => string;
}

export function makeLinks(prefix: View | null): Links {
  return {
    home: routeHash({ name: 'home' }, prefix),
    coverage: routeHash({ name: 'coverage' }, prefix),
    data: routeHash({ name: 'data' }, prefix),
    dictionaries: routeHash({ name: 'dictionaries' }, prefix),
    history: routeHash({ name: 'history' }, prefix),
    chapter: (id) => routeHash({ name: 'chapter', id }, prefix),
    domain: (id) => routeHash({ name: 'domain', id }, prefix),
  };
}

export const LinksContext = createContext<Links>(makeLinks(null));
export const useLinks = (): Links => useContext(LinksContext);

/** The view the reader is in. */
export const ViewContext = createContext<View>('product');
export const useView = (): View => useContext(ViewContext);
