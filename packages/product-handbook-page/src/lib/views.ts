import { isInView, routeHash } from './route';
import type { Route, RouteBody } from './route';
import type { Feature, PageData, View } from './types';

/** The route without its view prefix. */
export function bodyOf(route: Route): RouteBody {
  const { view: _view, ...body } = route;
  return body as RouteBody;
}

/** Whether the data has the entity the route names (a feature, a domain, a role, an application, an external system); the pages without an entity always do. */
export function entityExists(data: PageData, route: RouteBody): boolean {
  switch (route.name) {
    case 'feature': return data.features.some((feature) => feature.id === route.id);
    case 'domain': return data.domains.some((domain) => domain.id === route.id);
    case 'role': return data.entities.roles.some((role) => role.label === route.label);
    case 'application': return data.system.applications.some((application) => application.dir === route.dir);
    case 'system': return (data.technical?.integrations ?? []).some((item) => item.system === route.system);
    case 'not-found': return false;
    default: return true;
  }
}

/** The view a route is shown in, or null when the page does not have it (a view it was not built with, or a page the view does not have). */
export function viewOf(data: PageData, route: Route): View | null {
  const view = route.view ?? data.views[0];
  if (!data.views.includes(view)) return null;
  return isInView(bodyOf(route), view) ? view : null;
}

/**
 * The fragment that shows the same entity in `view`; the overview of that view
 * when the entity is not there (a page or entity the other view does not have).
 */
export function switchTarget(data: PageData, route: Route, view: View): string {
  const body = bodyOf(route);
  const there = isInView(body, view) && entityExists(data, body);
  return routeHash(there ? body : { name: 'overview' }, view);
}

/** One application of the technical navigation: the domains whose features have quoted passages in it, and those features. */
export interface ApplicationNav { dir: string; label: string; domains: { id: string; name: string; features: Feature[] }[] }

/**
 * The technical navigation: each application with the domains that have
 * quoted passages in it and, under each domain, the features whose passages
 * fall in the application; then the features that fall in no application, so
 * every feature is somewhere in the navigation.
 */
export function technicalNav(data: PageData): { applications: ApplicationNav[]; unplaced: Feature[] } {
  const technical = data.technical;
  const rows = technical?.featureApplication ?? [];
  const cells = technical?.applicationDomain.cells ?? [];
  const applications = data.system.applications.map((application) => ({
    dir: application.dir,
    label: application.name ?? application.dir,
    domains: data.domains
      .filter((domain) => cells.some((cell) => cell.application === application.dir && cell.domain === domain.id))
      .map((domain) => ({
        id: domain.id,
        name: domain.name,
        features: data.features.filter((feature) => feature.domain === domain.id && rows.some((row) => row.feature === feature.id && row.application === application.dir)),
      })),
  }));
  const unplaced = data.features.filter((feature) => !rows.some((row) => row.feature === feature.id));
  return { applications, unplaced };
}
