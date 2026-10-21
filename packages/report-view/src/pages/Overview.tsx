import { useMemo } from 'react';

import { LoadError } from '../components/ProductPage';
import { Card } from '../components/ui/Card';
import { Facts, Pills } from '../components/ui/Controls';
import { SimpleTable } from '../components/ui/DataTable';
import { Page } from '../components/ui/Page';
import { RevisionBanner } from '../components/ui/ProductCards';
import { StatusBadge } from '../components/ui/Badge';
import { Tile, Tiles } from '../components/ui/Tile';
import { parseGraphJsonl } from '../data/graph';
import type { Manifest, ManifestProduct } from '../data/manifest';
import { useCounts, useReady } from '../hooks/use-signals';
import { formatNumber } from '../lib/format';
import { nodeColor } from '../lib/node-colors';
import { detailText, statusLabel } from '../lib/products';
import { summarizeGraph, type GraphSummary } from '../lib/overview';
import { useLoaded, useViewer } from '../state/viewer';

function productRow(product: ManifestProduct, snapshot: string) {
  let detail: React.ReactNode[] = [<div key="d">{detailText(product, snapshot)}</div>];
  if (product.items) {
    detail = product.items.map((item) => (
      <div key={item.name}>{`${item.file}: ${statusLabel(item.status).toLowerCase()}${item.status === 'not-run' ? ` (${item.command})` : ''}`}</div>
    ));
  } else if (product.status === 'not-run') {
    detail.push(<div key="c">Command: <code>{product.command}</code></div>);
  }
  const revision = product.revision || (product.status === 'not-run' || product.status === 'unreadable' ? '' : 'none recorded');
  return [product.label, <StatusBadge key="s" status={product.status} />, detail, <span key="r" className="font-mono text-[12.5px]">{revision}</span>];
}

function TypeTable({ title, label, rows, colour }: { title: string; label: string; rows: GraphSummary['nodesByType']; colour?: boolean }) {
  return (
    <Card title={title}>
      <SimpleTable
        columns={[{ label: 'Type' }, { label, num: true }]}
        rows={rows.map((r) => [
          colour ? (
            <span key="t" className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: nodeColor(r.type) }} />
              {r.type}
            </span>
          ) : r.type,
          formatNumber(r.count),
        ])}
      />
    </Card>
  );
}

function GraphCards({ summary }: { summary: GraphSummary }) {
  const { project, totals, coverage } = summary;
  const listed = (values: string[]) => (values.length > 0 ? <Pills values={values} /> : 'none listed');
  const facts: (readonly [string, React.ReactNode])[] = [];
  if (project.name !== null) facts.push(['Name in graph', project.name]);
  if (summary.kind !== null) facts.push(['Kind', summary.kind]);
  if (project.description !== null) facts.push(['Description', project.description]);
  facts.push(['Languages', listed(project.languages)], ['Frameworks', listed(project.frameworks)]);
  const tiles: [string, number | null][] = [['Nodes', totals.nodes], ['Edges', totals.edges], ['Gaps', totals.gaps]];
  if (coverage && coverage.files !== null) tiles.push(['Files in coverage', coverage.files]);
  if (coverage && coverage.ignored !== null) tiles.push(['Ignored', coverage.ignored]);
  return (
    <>
      <Card title="Knowledge graph">
        <Facts items={facts} />
      </Card>
      <Card title="Counts">
        <Tiles>{tiles.map(([label, value]) => <Tile key={label} label={label} value={value} />)}</Tiles>
        {summary.notes.map((note) => <p key={note} className="mt-2 text-muted">{note}</p>)}
      </Card>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
        <TypeTable title="Nodes by type" label="Nodes" rows={summary.nodesByType} colour />
        <TypeTable title="Edges by type" label="Edges" rows={summary.edgesByType} />
      </div>
      {coverage && coverage.languages.length > 0 ? (
        <Card title="Coverage by language">
          <SimpleTable
            columns={[{ label: 'Language' }, { label: 'Files', num: true }, { label: 'Parsed', num: true }, { label: 'Zero symbols', num: true }, { label: 'Skipped', num: true }, { label: 'Functions', num: true }, { label: 'Classes', num: true }]}
            rows={coverage.languages.map((r) => [r.language, formatNumber(r.files), formatNumber(r.parsed), formatNumber(r.zeroSymbol), formatNumber(r.skipped), formatNumber(r.functions), formatNumber(r.classes)])}
          />
        </Card>
      ) : null}
      {summary.gapsByKind.length > 0 ? (
        <Card title="Gaps by kind">
          <SimpleTable columns={[{ label: 'Kind' }, { label: 'Gap records', num: true }, { label: 'Sum of counts', num: true }]} rows={summary.gapsByKind.map((r) => [r.kind, formatNumber(r.records), formatNumber(r.count)])} />
        </Card>
      ) : null}
    </>
  );
}

function revisionBanners(manifest: Manifest) {
  return manifest.products.map((product) => <RevisionBanner key={product.name} manifest={manifest} product={product} />);
}

export function OverviewPage() {
  const { manifest, payloads } = useViewer();
  const snapshot = manifest.snapshot.revision;
  const graph = manifest.products.find((p) => p.name === 'knowledge-graph');
  const wantsGraph = graph !== undefined && (graph.status === 'included' || graph.status === 'different-revision');
  const loaded = useLoaded(wantsGraph ? 'graph' : '', async () => (wantsGraph ? summarizeGraph(parseGraphJsonl(await payloads.text(graph.payloads[0]))) : null));
  const summary = loaded.state === 'ready' ? loaded.value : null;
  useCounts(summary ? { nodes: summary.totals.nodes, edges: summary.totals.edges, gaps: summary.totals.gaps } : null);
  useReady(wantsGraph ? loaded.state : 'ready');
  const rows = useMemo(() => manifest.products.map((p) => productRow(p, snapshot)), [manifest, snapshot]);
  return (
    <Page title="Overview" subtitle={manifest.project.name}>
      {revisionBanners(manifest)}
      <Card title="Project">
        <Facts items={[['Project', manifest.project.name], ['Source snapshot', <span key="s" className="font-mono text-[12.5px]">{snapshot}</span>]]} />
      </Card>
      <Card title="Products">
        <SimpleTable columns={[{ label: 'Product' }, { label: 'Status' }, { label: 'Detail', wrap: true }, { label: 'Revision' }]} rows={rows} />
      </Card>
      {loaded.state === 'error' ? <LoadError title="The knowledge graph could not be read" error={loaded.error} /> : null}
      {summary ? <GraphCards summary={summary} /> : null}
    </Page>
  );
}
