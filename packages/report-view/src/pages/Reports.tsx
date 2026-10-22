import { motion } from 'motion/react';
import { useMemo } from 'react';

import { Markdown } from '../components/Markdown';
import { LoadError } from '../components/ProductPage';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Page } from '../components/ui/Page';
import { unavailableCard } from '../components/ui/ProductCards';
import { useRoute } from '../hooks/use-route';
import { useCounts, useReady } from '../hooks/use-signals';
import type { ReportItem } from '../data/manifest';
import { EMPTY } from '../lib/format';
import { CARD_VARIANTS } from '../lib/motion';
import { statusLabel } from '../lib/products';
import { buildHash } from '../lib/route';
import { useProduct, useTextPayload } from '../state/viewer';

// The route name of each report and the manifest item it shows.
const ROUTES: Record<string, string> = { hotspots: 'hotspots-report', 'doc-map': 'doc-map-report' };
const ROUTE_NAMES = Object.keys(ROUTES);

const statusBadge = (status: string) => <Badge tone={status === 'included' ? 'success' : 'neutral'}>{statusLabel(status)}</Badge>;

/** One report as a card: its file, its status, and the way to open or produce it. */
function ReportTile({ name, item }: { name: string; item: ReportItem | undefined }) {
  const status = item ? item.status : 'not-run';
  return (
    <motion.article variants={CARD_VARIANTS} data-xv-report-card={name} data-xv-report-status={status} className="flex min-w-0 flex-col gap-2 rounded-card bg-surface px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[18px] [overflow-wrap:anywhere]">{item ? item.label : name}</h2>
        {statusBadge(status)}
      </div>
      <p className="m-0 font-mono text-[12.5px] text-muted [overflow-wrap:anywhere]">{item ? item.file : EMPTY}</p>
      {item && item.status === 'included' ? (
        <a href={buildHash('reports', {}, name)} className="mt-auto self-start">Open the report</a>
      ) : item ? (
        <p className="m-0 mt-auto">Not run. Command: <code>{item.command}</code></p>
      ) : null}
    </motion.article>
  );
}

function ReportList({ items }: { items: ReportItem[] }) {
  const itemFor = (routeName: string) => items.find((item) => item.name === ROUTES[routeName]);
  const included = items.filter((item) => item.status === 'included').length;
  useCounts({ reports: included });
  useReady('ready');
  return (
    <>
      <p className="m-0 text-muted">Reports are written by a model from the products; this viewer shows them as written.</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
        {ROUTE_NAMES.map((name) => <ReportTile key={name} name={name} item={itemFor(name)} />)}
      </div>
    </>
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
