import { useEffect, useMemo, useState } from 'react';

import { ApplicationPage, ApplicationsMatrixPage } from './components/ApplicationPages';
import { CoveragePage } from './components/CoveragePage';
import { DataPage } from './components/DataPage';
import { DictionariesPage } from './components/DictionariesPage';
import { DomainPage } from './components/DomainPage';
import { FeaturePage } from './components/FeaturePage';
import { JobsPage } from './components/JobsPage';
import { NotFound } from './components/NotFound';
import { NotificationsPage } from './components/NotificationsPage';
import { Overview } from './components/Overview';
import { RolePage, RolesMatrixPage } from './components/RolePages';
import { Sidebar } from './components/Sidebar';
import { SystemPage } from './components/SystemPage';
import { TopBar } from './components/TopBar';
import { LinksContext, ViewContext, makeLinks } from './lib/links';
import type { Route } from './lib/route';
import { TextContext, makeText } from './lib/text';
import type { PageData, View } from './lib/types';
import { useRoute } from './lib/use-route';
import { bodyOf, entityExists, switchTarget, viewOf } from './lib/views';

/** The view of one page: the route's page, or the not-found page when the view or the entity is not in the data. */
function PageView({ data, route, view }: { data: PageData; route: Route; view: View | null }) {
  const body = bodyOf(route);
  if (view === null || !entityExists(data, body)) return <NotFound />;
  const technical = view === 'technical' ? data.technical : undefined;
  switch (body.name) {
    case 'overview': return <Overview data={data} />;
    case 'coverage': return <CoveragePage data={data} />;
    case 'notifications': return <NotificationsPage data={data} />;
    case 'jobs': return <JobsPage data={data} />;
    case 'data': return technical === undefined ? <NotFound /> : <DataPage data={data} technical={technical} />;
    case 'dictionaries': return technical === undefined ? <NotFound /> : <DictionariesPage data={data} technical={technical} />;
    case 'roles-matrix': return <RolesMatrixPage data={data} />;
    case 'applications-matrix': return technical === undefined ? <NotFound /> : <ApplicationsMatrixPage data={data} technical={technical} />;
    case 'application': return technical === undefined ? <NotFound /> : <ApplicationPage data={data} technical={technical} dir={body.dir} />;
    case 'system': return technical === undefined ? <NotFound /> : <SystemPage data={data} technical={technical} system={body.system} />;
    case 'role': return <RolePage data={data} label={body.label} />;
    case 'domain': {
      const domain = data.domains.find((item) => item.id === body.id);
      return domain === undefined ? <NotFound /> : <DomainPage data={data} domain={domain} />;
    }
    case 'feature': {
      const feature = data.features.find((item) => item.id === body.id);
      return feature === undefined
        ? <NotFound />
        : <FeaturePage feature={feature} domain={data.domains.find((item) => item.id === feature.domain)} area={data.domainBasis === 'domains' ? data.areas.find((item) => item.id === feature.area) : undefined} locations={technical?.locations.find((unit) => unit.id === feature.id)} />;
    }
    case 'not-found': return <NotFound />;
  }
}

/** The page for a route: the shell (bar, navigation) around one view. Pure in its props, so a test can render any route to a string. */
export function AppView({ data, route }: { data: PageData; route: Route }) {
  const t = useMemo(() => makeText(data.ui.strings), [data.ui.strings]);
  const [menuOpen, setMenuOpen] = useState(false);
  const view = viewOf(data, route);
  const current: View = view ?? data.views[0];
  const links = useMemo(() => makeLinks(data.views.length > 1 ? current : null), [data.views.length, current]);
  const switchTo = Object.fromEntries(data.views.map((item) => [item, switchTarget(data, route, item)])) as Record<View, string>;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <TextContext.Provider value={t}>
      <ViewContext.Provider value={current}>
        <LinksContext.Provider value={links}>
          <div className="app">
            <TopBar project={data.project} menuOpen={menuOpen} onMenu={() => setMenuOpen(!menuOpen)} views={data.views} current={current} switchTo={switchTo} />
            <div className="shell">
              {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
              <Sidebar data={data} route={route} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
              <main className="main" id="main"><PageView data={data} route={route} view={view} /></main>
            </div>
          </div>
        </LinksContext.Provider>
      </ViewContext.Provider>
    </TextContext.Provider>
  );
}

/** The title of the page a route shows. */
function pageTitle(data: PageData, route: Route, t: ReturnType<typeof makeText>): string {
  const body = bodyOf(route);
  switch (body.name) {
    case 'overview': return t('page.nav.overview');
    case 'coverage': return t('page.nav.coverage');
    case 'notifications': return t('page.nav.notifications');
    case 'jobs': return t('page.nav.jobs');
    case 'data': return t('md.data.heading');
    case 'dictionaries': return t('md.dict.heading');
    case 'roles-matrix': return t('md.matrix.roleFeature.heading');
    case 'applications-matrix': return t('md.matrix.applicationDomain.heading');
    case 'role': return entityExists(data, body) ? body.label : t('page.notFound.heading');
    case 'system': return entityExists(data, body) ? body.system : t('page.notFound.heading');
    case 'application': {
      const application = data.system.applications.find((item) => item.dir === body.dir);
      return application === undefined ? t('page.notFound.heading') : application.name ?? application.dir;
    }
    case 'domain': return data.domains.find((item) => item.id === body.id)?.name ?? t('page.notFound.heading');
    case 'feature': return data.features.find((item) => item.id === body.id)?.name ?? t('page.notFound.heading');
    case 'not-found': return t('page.notFound.heading');
  }
}

/** The browser title of a route: the page, the system name and the handbook; without a name the page and the handbook, never the directory of the project. */
export function documentTitle(data: PageData, route: Route): string {
  const t = makeText(data.ui.strings);
  const page = viewOf(data, route) === null ? t('page.notFound.heading') : pageTitle(data, route, t);
  return data.project === null ? t('page.documentTitleNoName', { page }) : t('page.documentTitle', { project: data.project, page });
}

/** The document's own text: its language and its title come from the data, like everything else. */
function useDocument(data: PageData, route: Route): void {
  useEffect(() => {
    document.documentElement.lang = data.languageTag;
  }, [data.languageTag]);
  useEffect(() => {
    document.title = documentTitle(data, route);
  }, [route, data]);
}

export function App({ data }: { data: PageData }) {
  const route = useRoute();
  useDocument(data, route);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);
  return <AppView data={data} route={route} />;
}
