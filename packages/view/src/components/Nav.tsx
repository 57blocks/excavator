import { SECTIONS, routeSection, sectionHash, type Route } from '../routes';

export function Nav({ route, projectName }: { route: Route; projectName: string | null }) {
  const current = routeSection(route);
  return (
    <header className="topbar">
      <div className="brand">
        Excavator
        {projectName !== null && <span className="project">{projectName}</span>}
      </div>
      <nav className="nav" aria-label="Sections">
        {SECTIONS.map((section) => (
          <a key={section.id} href={sectionHash(section.id)} aria-current={current === section.id ? 'page' : undefined}>
            {section.label}
          </a>
        ))}
        <a href="#/open" aria-current={route.kind === 'open' ? 'page' : undefined} data-nav="open">
          Open directory
        </a>
      </nav>
    </header>
  );
}
