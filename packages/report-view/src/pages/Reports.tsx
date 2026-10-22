import { useMemo } from 'react';

import { Markdown } from '../components/Markdown';
import { LoadError } from '../components/ProductPage';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { SimpleTable } from '../components/ui/DataTable';
import { Page } from '../components/ui/Page';
import { unavailableCard } from '../components/ui/ProductCards';
import { useRoute } from '../hooks/use-route';
import { useCounts, useReady } from '../hooks/use-signals';
import type { ReportItem } from '../data/manifest';
import { EMPTY } from '../lib/format';
import { statusLabel } from '../lib/products';
import { buildHash } from '../lib/route';
import { useProduct, useTextPayload } from '../state/viewer';

// The route name of each report and the manifest item it shows.
const ROUTES: Record<string, string> = { hotspots: 'hotspots-report', 'doc-map': 'doc-map-report' };
const ROUTE_NAMES = Object.keys(ROUTES);

const statusBadge = (status: string) => <Badge tone={status === 'included' ? 'success' : 'neutral'}>{statusLabel(status)}</Badge>;

function ReportList({ items }: { items: ReportItem[] }) {
  const itemFor = (routeName: string) => items.find((item) => item.name === ROUTES[routeName]);
  const rows = ROUTE_NAMES.map((name) => {
    const item = itemFor(name);
    if (!item) return [name, statusBadge('not-run'), EMPTY];
    return [
      item.file,
      statusBadge(item.status),
      item.status === 'included' ? <a key="o" href={buildHash('reports', {}, name)}>Open</a> : <span key="c">Not run. Command: <code>{item.command}</code></span>,
    ];
  });
  const included = items.filter((item) => item.status === 'included').length;
  useCounts({ reports: included });
  useReady('ready');
  return (
    <Card title="Reports">
      <p className="text-muted">Reports are written by a model from the products; this viewer shows them as written.</p>
      <SimpleTable columns={[{ label: 'Report' }, { label: 'Status' }, { label: 'Open or produce', wrap: true }]} rows={rows} />
    </Card>
  );
}

function ReportText({ item, included }: { item: ReportItem; included: number }) {
  const loaded = useTextPayload(item.payload as string);
  const lineCount = loaded.state === 'ready' ? (loaded.value === '' ? 0 : loaded.value.replace(/\n$/, '').split('\n').length) : 0;
  useCounts(loaded.state === 'ready' ? { reports: included, 'report-lines': lineCount } : null);
  useReady(loaded.state);
  if (loaded.state === 'error') return <LoadError title="This report could not be read" error={loaded.error} />;
  if (loaded.state === 'loading') return null;
  return (
    <Card>
      <p className="text-muted">{`${item.file}: ${lineCount} lines. Written by a model from the products; shown as written.`}</p>
      <Markdown text={loaded.value} />
    </Card>
  );
}

/** A report that is not a report of this viewer, or that was not run: the page is drawn, with nothing to show. */
function ReportCard({ children }: { children: React.ReactNode }) {
  useCounts({ reports: 0 });
  useReady('ready');
  return children;
}

function OneReport({ name, items }: { name: string; items: ReportItem[] }) {
  const item = Object.hasOwn(ROUTES, name) ? items.find((i) => i.name === ROUTES[name]) : undefined;
  const back = (
    <p className="mb-3">
      <a href={buildHash('reports')}>All reports</a>
    </p>
  );
  if (!item) {
    return (
      <ReportCard>
        <Card title="No such report" tone="error">
          <p>{`"${name}" is not a report of this viewer.`}</p>
        </Card>
      </ReportCard>
    );
  }
  if (item.status !== 'included') {
    return (
      <ReportCard>
        {back}
        {unavailableCard({ status: 'not-run', label: item.label, file: item.file, command: item.command, reason: null })}
      </ReportCard>
    );
  }
  return (
    <>
      {back}
      <ReportText item={item} included={items.filter((i) => i.status === 'included').length} />
    </>
  );
}

export function ReportsPage() {
  const { route } = useRoute();
  const product = useProduct('reports');
  const items = useMemo(() => product.items ?? [], [product]);
  const name = route.rest;
  return (
    <Page title="Reports" subtitle={name === '' ? 'The reports the skills wrote from the products.' : null}>
      {name === '' ? <ReportList items={items} /> : <OneReport name={name} items={items} />}
    </Page>
  );
}
