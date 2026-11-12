import { createContext, useContext } from 'react';

import { routeHash } from './route';
import type { View } from './types';

/** The address of each page, in the view the reader is in: with the view in front when the page has two views, without it when it has one. */
export interface Links {
  overview: string;
  coverage: string;
  notifications: string;
  jobs: string;
  findings: string;
  recommendations: string;
  topics: string;
  history: string;
  openQuestions: string;
  glossary: string;
  sources: string;
  data: string;
  dictionaries: string;
  rolesMatrix: string;
  applicationsMatrix: string;
  feature: (id: string) => string;
  domain: (id: string) => string;
  role: (label: string) => string;
  application: (dir: string) => string;
  system: (name: string) => string;
}

export function makeLinks(prefix: View | null): Links {
  return {
    overview: routeHash({ name: 'overview' }, prefix),
    coverage: routeHash({ name: 'coverage' }, prefix),
    notifications: routeHash({ name: 'notifications' }, prefix),
    jobs: routeHash({ name: 'jobs' }, prefix),
    findings: routeHash({ name: 'findings' }, prefix),
    recommendations: routeHash({ name: 'recommendations' }, prefix),
    topics: routeHash({ name: 'topics' }, prefix),
    history: routeHash({ name: 'history' }, prefix),
    openQuestions: routeHash({ name: 'open-questions' }, prefix),
    glossary: routeHash({ name: 'glossary' }, prefix),
    sources: routeHash({ name: 'sources' }, prefix),
    data: routeHash({ name: 'data' }, prefix),
    dictionaries: routeHash({ name: 'dictionaries' }, prefix),
    rolesMatrix: routeHash({ name: 'roles-matrix' }, prefix),
    applicationsMatrix: routeHash({ name: 'applications-matrix' }, prefix),
    feature: (id) => routeHash({ name: 'feature', id }, prefix),
    domain: (id) => routeHash({ name: 'domain', id }, prefix),
    role: (label) => routeHash({ name: 'role', label }, prefix),
    application: (dir) => routeHash({ name: 'application', dir }, prefix),
    system: (system) => routeHash({ name: 'system', system }, prefix),
  };
}

export const LinksContext = createContext<Links>(makeLinks(null));
export const useLinks = (): Links => useContext(LinksContext);

/** The view the reader is in. */
export const ViewContext = createContext<View>('product');
export const useView = (): View => useContext(ViewContext);
