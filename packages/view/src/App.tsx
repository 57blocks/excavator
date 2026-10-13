import { Component, useEffect, type ReactNode } from 'react';
import type { ViewData } from './data';
import { Nav } from './components/Nav';
import { Overview } from './views/Overview';
import { Coverage } from './views/Coverage';
import { Placeholder } from './views/Placeholder';
import { NodeRoute } from './views/NodeRoute';
import { routeName, sectionHash, useRoute, type Route } from './routes';

function View({ data, route }: { data: ViewData; route: Route }) {
  if (route.kind === 'node') return <NodeRoute data={data} id={route.id} />;
  if (route.kind === 'unknown') {
    return (
      <div className="content" data-section="unknown">
        <section className="card">
          <h2>Unknown location</h2>
          <p>
            This page has no view for <code>{route.hash}</code>. <a href={sectionHash('overview')}>Go to the overview</a>.
          </p>
        </section>
      </div>
    );
  }
  if (route.section === 'overview') return <Overview data={data} />;
  if (route.section === 'coverage') return <Coverage data={data} scope={route.params.get('scope')} />;
  return <Placeholder section={route.section} />;
}

export function App({ data, onFirstView }: { data: ViewData; onFirstView: () => void }) {
  const route = useRoute();
  useEffect(() => {
    document.getElementById('root')?.setAttribute('data-route', routeName(route));
  }, [route]);
  useEffect(onFirstView, []);
  const project = data.meta.graph?.fields?.project as { name?: unknown } | undefined;
  return (
    <div className="app">
      <Nav route={route} projectName={typeof project?.name === 'string' ? project.name : null} />
      <main>
        <View data={data} route={route} />
      </main>
    </div>
  );
}

export function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="app">
      <div className="alert" role="alert">
        <strong>{title}</strong>
        {children && <div className="secondary">{children}</div>}
      </div>
    </div>
  );
}

/** Render errors count as page errors and show a message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    if (this.state.error) return <Message title="This view failed to render">{`${this.state.error.name}: ${this.state.error.message}`}</Message>;
    return this.props.children;
  }
}
