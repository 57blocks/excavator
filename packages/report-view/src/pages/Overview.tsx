import { useMemo } from 'react';

import { LoadError } from '../components/ProductPage';
import { Card } from '../components/ui/Card';
import { Facts, Pills } from '../components/ui/Controls';
import { SimpleTable } from '../components/ui/DataTable';
import { Page } from '../components/ui/Page';
import { RevisionBanner } from '../components/ui/ProductCards';
import { StatusBadge } from '../components/ui/Badge';
import { Tile, Tiles } from '../components/ui/Tile';
import { NodeSummary } from '../components/NodeSummary';
import { CodeLink } from '../components/ui/CodeLink';
import { type Column, DataTable } from '../components/ui/DataTable';
import { loadGraphModel } from '../data/model';
import { domainCountsText } from '../lib/domain-details';
import type { Manifest, ManifestProduct } from '../data/manifest';
import type { GraphIndex } from '../data/indexes';
import { useCounts, useReady } from '../hooks/use-signals';
import { formatNumber } from '../lib/format';
import { nodeColor } from '../lib/node-colors';
import { detailText, statusLabel } from '../lib/products';
import { nodeSummaryView } from '../lib/node-summary';
import { summarizeGraph, type GraphSummary } from '../lib/overview';
import { semanticsCounts, semanticsDetail, semanticsStats, type ContradictedNode, type SemanticsStats } from '../lib/semantics-view';
import { useLoaded, useViewer } from '../state/viewer';

function productRow(product: ManifestProduct, snapshot: string, semantics: SemanticsStats | null) {
  let detail: React.ReactNode[] = [<div key="d">{detailText(product, snapshot)}</div>];
  if (product.name === 'semantics' && semantics) detail.push(<div key="n">{semanticsDetail(semantics)}</div>);
  const domainText = product.name === 'domain-graph' && (product.status === 'included' || product.status === 'different-revision') ? domainCountsText(product.counts) : null;
  if (domainText) detail.push(<div key="dc" data-xv-domain-counts="">{domainText}</div>);
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

const VERDICT_ROWS: readonly [string, string][] = [
  ['verified', 'Verified'], ['unverified', 'Unverified'], ['contradicted', 'Contradicted (not shown)'], ['unchecked', 'Unchecked'],
];

const LAYER_SOURCE_TEXT = { semantic: 'from the semantic graph', graph: 'from the graph\'s layer records', none: 'none in any source' } as const;

function contradictedColumns(index: GraphIndex): Column<ContradictedNode>[] {
  return [
    { label: 'Node', key: (r) => r.name, title: (r) => r.id, render: (r) => r.name },
    { label: 'Type', key: (r) => r.type, render: (r) => r.type },
    { label: 'File', width: 'lg', key: (r) => r.filePath, title: (r) => r.filePath, render: (r) => (r.filePath === null ? null : <CodeLink path={r.filePath} />) },
    {
      label: 'Summary',
      key: (r) => r.id,
      render: (r) => {
        const view = nodeSummaryView(index, r.id);
        return view ? <NodeSummary view={view} showTags={false} /> : null;
      },
    },
  ];
}

function SemanticsCards({ stats, index }: { stats: SemanticsStats; index: GraphIndex }) {
  const tiles: [string, number | null][] = [
    ['Summaries shown', stats.summariesShown], ['Inlined entries', stats.entries], ['Not fresh, left out', stats.stale],
    ...VERDICT_ROWS.map(([key, label]): [string, number | null] => [label, stats.byVerdict[key] ?? 0]),
    ['Layers', stats.layers],
  ];
  const columns = contradictedColumns(index);
  return (
    <>
      <Card title="Semantics">
        <Tiles>{tiles.map(([label, value]) => <Tile key={label} label={label} value={value} />)}</Tiles>
        <p className="mt-3 text-muted">{`Layers: ${LAYER_SOURCE_TEXT[stats.layerSource]}. A summary whose entry was written for older source is not fresh and is not shown.`}</p>
      </Card>
      {stats.contradicted.length > 0 ? (
        <Card title="Summaries that disagree with the source">
          <DataTable rows={stats.contradicted} columns={columns} />
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
  const loaded = useLoaded(wantsGraph ? 'graph' : '', async () => {
    const model = wantsGraph ? await loadGraphModel(manifest, payloads) : null;
    if (!model) return null;
    const semanticsProduct = manifest.products.find((p) => p.name === 'semantics');
    return {
      summary: summarizeGraph(model.graph),
      index: model.index,
      semantics: model.semantics ? semanticsStats(model.index, model.semantics, semanticsProduct) : null,
    };
  });
  const ready = loaded.state === 'ready' ? loaded.value : null;
  const summary = ready?.summary ?? null;
  const semantics = ready?.semantics ?? null;
  const domain = manifest.products.find((p) => p.name === 'domain-graph');
  const domainCounts: Record<string, number> = domain && (domain.status === 'included' || domain.status === 'different-revision') && domainCountsText(domain.counts) !== null
    ? { 'domain-domains': domain.counts?.domains as number, 'domain-flows': domain.counts?.flows as number, 'domain-steps': domain.counts?.steps as number, 'domain-cross': domain.counts?.crossDomain as number }
    : {};
  useCounts(summary ? { nodes: summary.totals.nodes, edges: summary.totals.edges, gaps: summary.totals.gaps, ...(semantics ? semanticsCounts(semantics) : {}), ...domainCounts } : null);
  useReady(wantsGraph ? loaded.state : 'ready');
  const rows = useMemo(() => manifest.products.map((p) => productRow(p, snapshot, semantics)), [manifest, snapshot, semantics]);
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
      {ready && semantics ? <SemanticsCards stats={semantics} index={ready.index} /> : null}
      {summary ? <GraphCards summary={summary} /> : null}
    </Page>
  );
}
