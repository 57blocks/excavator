import { motion } from 'motion/react';

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
import { formatNumber, NOT_PROVIDED } from '../lib/format';
import { CARD_VARIANTS } from '../lib/motion';
import { inPage, keyNumbers, PAYLOAD_PRODUCTS, PRODUCT_PAGES, type KeyNumber } from '../lib/product-cards';
import { buildHash } from '../lib/route';
import { nodeColor } from '../lib/node-colors';
import { detailText, statusLabel } from '../lib/products';
import { nodeSummaryView } from '../lib/node-summary';
import { summarizeGraph, type GraphSummary } from '../lib/overview';
import { semanticsCounts, semanticsDetail, semanticsStats, type ContradictedNode, type SemanticsStats } from '../lib/semantics-view';
import { useLoaded, useViewer } from '../state/viewer';

function productDetail(product: ManifestProduct, snapshot: string, semantics: SemanticsStats | null): React.ReactNode[] {
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
  return detail;
}

/** One product's card: its state, its key numbers, what the packer says about it, its revision, and the way to its page. */
function ProductCard({ product, snapshot, semantics, numbers }: { product: ManifestProduct; snapshot: string; semantics: SemanticsStats | null; numbers: KeyNumber[] | null | Error }) {
  const revision = product.revision || (product.status === 'not-run' || product.status === 'unreadable' ? '' : 'none recorded');
  const page = PRODUCT_PAGES[product.name];
  return (
    <motion.article variants={CARD_VARIANTS} data-xv-product-card={product.name} data-xv-product-status={product.status} className="flex min-w-0 flex-col gap-2.5 rounded-card bg-surface px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[18px] [overflow-wrap:anywhere]">{product.label}</h2>
        <StatusBadge status={product.status} />
      </div>
      {numbers instanceof Error ? <p className="m-0 text-xs text-muted">{`The product could not be read: ${numbers.message}`}</p> : numbers === null ? <p className="m-0 text-xs text-muted">Reading the product.</p> : numbers.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-2">
          {numbers.map((n) => (
            <div key={n.label} data-xv-product-number={n.label} data-xv-product-value={n.value === null ? '' : String(n.value)}>
              <dt className="text-[11px] uppercase tracking-wider text-muted">{n.label}</dt>
              <dd className="m-0 font-heading text-[22px] leading-7 text-ink">{n.value === null ? <span className="font-sans text-xs text-muted">{NOT_PROVIDED}</span> : formatNumber(n.value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">{productDetail(product, snapshot, semantics)}</div>
      {revision === '' ? null : <p className="m-0 font-mono text-[12px] text-muted [overflow-wrap:anywhere]">{`Revision ${revision}`}</p>}
      {page === undefined ? null : <a href={buildHash(page)} className="mt-auto self-start" data-xv-product-link={page}>{`Open ${PAGE_LABELS[page] ?? page}`}</a>}
    </motion.article>
  );
}

const PAGE_LABELS: Record<string, string> = { graph: 'the graph', domain: 'the domain graph', unused: 'Unused code', 'doc-map': 'Doc map', hotspots: 'Hotspots', reports: 'Reports' };

/** The parsed payloads of the products whose key numbers come from them, for those in the page. */
function usePayloadNumbers(manifest: Manifest, payloads: ReturnType<typeof useViewer>['payloads']) {
  const wanted = manifest.products.filter((p) => PAYLOAD_PRODUCTS.includes(p.name) && inPage(p) && p.payloads.length > 0);
  return useLoaded(wanted.map((p) => p.name).join(','), async () => {
    const data: Record<string, Record<string, any> | Error> = {};
    for (const product of wanted) {
      try {
        data[product.name] = await payloads.parsed<Record<string, any>>(product.payloads[0]);
      } catch (error) {
        data[product.name] = error instanceof Error ? error : new Error(String(error));
      }
    }
    return data;
  });
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

/** The Products page (formerly the Overview page): every product's state, then the graph's and the semantics' counts. */
export function ProductsPage() {
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
  const payloadNumbers = usePayloadNumbers(manifest, payloads);
  useReady(payloadNumbers.state === 'loading' ? 'loading' : wantsGraph ? loaded.state : 'ready');
  const numbersOf = (product: ManifestProduct): KeyNumber[] | null | Error => {
    if (!PAYLOAD_PRODUCTS.includes(product.name)) return keyNumbers(product, { graph: summary ? summary.totals : loaded.state === 'loading' ? null : undefined });
    if (!inPage(product)) return keyNumbers(product, {});
    if (payloadNumbers.state === 'loading') return null;
    if (payloadNumbers.state === 'error') return payloadNumbers.error;
    const data = payloadNumbers.value[product.name];
    return data instanceof Error ? data : keyNumbers(product, { data });
  };
  return (
    <Page title="Products" subtitle={manifest.project.name}>
      {revisionBanners(manifest)}
      <Card title="Project">
        <Facts items={[['Project', manifest.project.name], ['Source snapshot', <span key="s" className="font-mono text-[12.5px]">{snapshot}</span>]]} />
      </Card>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5" data-xv-product-cards={manifest.products.length}>
        {manifest.products.map((p) => <ProductCard key={p.name} product={p} snapshot={snapshot} semantics={semantics} numbers={numbersOf(p)} />)}
      </div>
      {loaded.state === 'error' ? <LoadError title="The knowledge graph could not be read" error={loaded.error} /> : null}
      {ready && semantics ? <SemanticsCards stats={semantics} index={ready.index} /> : null}
      {summary ? <GraphCards summary={summary} /> : null}
    </Page>
  );
}
