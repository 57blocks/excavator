import { useMemo, type ReactNode } from 'react';

import type { DomainPayload } from '../../data/domain';
import { findProduct, type ManifestProduct } from '../../data/manifest';
import { formatNumber } from '../../lib/format';
import { summarizeGraph } from '../../lib/overview';
import { complexityCounts, hotspotHighlights, layerRows, overviewTiles, readable, topConnected, UNUSED_HREF, unusedHighlights } from '../../lib/project-overview';
import { nodeColor } from '../../lib/node-colors';
import type { GraphScene } from '../../state/graph-scene';
import { useLoaded, useViewer } from '../../state/viewer';
import { BarList } from '../ui/BarList';
import { StatTile } from '../ui/StatTile';

const SECTION = 'flex flex-col gap-2';
const HEADING = 'text-[11px] font-semibold uppercase tracking-wider text-muted';
const ROW_BUTTON = 'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-1.5 py-1 text-left hover:bg-paper';
const CONFIDENCE_COLOUR: Record<string, string> = { high: 'var(--color-unused-high)', medium: 'var(--color-unused-medium)', low: 'var(--color-unused-low)' };

/** The parsed payload of `product`, once, when the page holds it; null when it does not. */
function useProductPayload<T>(product: ManifestProduct | undefined) {
  const { payloads } = useViewer();
  const id = product && readable(product) ? product.payloads[0] : undefined;
  return useLoaded<T | null>(id ? `overview:${id}` : '', () => (id ? payloads.parsed<T>(id) : Promise.resolve(null)));
}

function Section({ name, title, children }: { name: string; title: string; children?: ReactNode }) {
  return (
    <section className={SECTION} data-xv-overview={name} aria-label={title}>
      <h3 className={HEADING}>{title}</h3>
      {children}
    </section>
  );
}

/** What the overview says for a product that is not in the page: not run with its command, or why it could not be read. */
function Unavailable({ product }: { product: ManifestProduct }) {
  if (product.status === 'unreadable') return <p className="m-0 text-xs text-muted" data-xv-highlight-state="unreadable">{`Unreadable: ${product.reason || 'the file could not be read.'}`}</p>;
  return (
    <p className="m-0 text-xs text-muted" data-xv-highlight-state="not-run">
      Not run. Command: <code>{product.command}</code>
    </p>
  );
}

function Pills({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) return <span className="text-xs text-muted">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => <span key={item} className="rounded-full border border-line-2 bg-surface px-2.5 py-0.5 text-xs text-ink-soft">{item}</span>)}
    </span>
  );
}

/**
 * The project overview (design D3): the sidebar of the Overview and Deep dive modes when nothing is selected. Every
 * number is a product field or a count over a product's entries (lib/project-overview).
 */
export function ProjectOverview({ scene, onSelectNode, onOpenLayer, onStartTour }: {
  scene: GraphScene;
  onSelectNode: (nodeId: string) => void;
  onOpenLayer: (path: string) => void;
  onStartTour: () => void;
}) {
  const { manifest } = useViewer();
  const { graph, index } = scene.model;
  const summary = useMemo(() => summarizeGraph(graph), [graph]);
  const tiles = useMemo(() => overviewTiles(graph, index, scene.structure), [graph, index, scene]);
  const connected = useMemo(() => topConnected(graph), [graph]);
  const complexity = useMemo(() => complexityCounts(graph.nodes), [graph]);
  const layers = useMemo(() => layerRows(scene.structure), [scene]);

  const domainProduct = findProduct(manifest, 'domain-graph');
  const unusedProduct = findProduct(manifest, 'unused-code');
  const hotspotsProduct = findProduct(manifest, 'hotspots');
  const tourProduct = findProduct(manifest, 'tour');
  const domain = useProductPayload<DomainPayload>(domainProduct);
  const unused = useProductPayload<{ unused?: unknown }>(unusedProduct);
  const hotspots = useProductPayload<{ files?: unknown }>(hotspotsProduct);
  const description = domain.state === 'ready' && typeof domain.value?.projectDescription === 'string' ? domain.value.projectDescription : null;
  const unusedFacts = useMemo(() => (unused.state === 'ready' && unused.value ? unusedHighlights(unused.value) : null), [unused]);
  const hotFiles = useMemo(() => (hotspots.state === 'ready' && hotspots.value ? hotspotHighlights(hotspots.value) : null), [hotspots]);

  const layerSource = index.semantics.layerSource === 'semantic' ? 'from the semantic graph' : index.semantics.layerSource === 'graph' ? "from the graph's layer records" : 'the graph has no layers';
  const grouped = scene.structure.mode === 'layers';

  return (
    <div className="flex flex-col gap-5 text-[13.5px]" data-xv-project-overview="">
      <header className="flex flex-col gap-1">
        <h2 className="font-heading text-[22px] leading-7" data-xv-overview-name="">{manifest.project.name}</h2>
        {description ? <p className="m-0 text-[13px] leading-5 text-ink-soft" data-xv-overview-description="">{description}</p> : null}
      </header>

      <div className="grid grid-cols-2 gap-2.5" data-xv-overview="tiles">
        <StatTile label="Nodes" value={tiles.nodes} note="node records" />
        <StatTile label="Edges" value={tiles.edges} note="edge records" />
        <StatTile label="Layers" value={tiles.layers} note={layerSource} />
        <StatTile label="Files" value={tiles.files} note="file nodes" />
      </div>

      <Section name="stack" title="Languages and frameworks">
        <div className="flex flex-col gap-1.5">
          <Pills items={summary.project.languages} empty="No language recorded in the graph header." />
          <Pills items={summary.project.frameworks} empty="No framework recorded in the graph header." />
        </div>
      </Section>

      <Section name="types" title="Node types">
        <BarList rows={summary.nodesByType.map((row) => ({ key: row.type, label: row.type, value: row.count, colour: nodeColor(row.type) }))} label="Nodes by type" />
      </Section>

      <Section name="complexity" title="Complexity">
        <BarList rows={complexity.map((row) => ({ key: row.key, label: row.label, value: row.count }))} label="Nodes by complexity" />
        <p className="m-0 text-xs text-muted">{"Counted from each node's complexity field; a node without one is counted as not recorded."}</p>
      </Section>

      <Section name="connected" title="Most connected">
        {connected.length === 0 ? <p className="m-0 text-xs text-muted">No node has an edge.</p> : (
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
            {connected.map((node) => (
              <li key={node.id}>
                <button type="button" data-xv-top-node={node.id} data-xv-degree={node.degree} onClick={() => onSelectNode(node.id)} className={ROW_BUTTON} title={`${node.type} ${node.name}`}>
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: nodeColor(node.type) }} />
                  <span className="min-w-0 flex-1 truncate text-ink">{node.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{`${formatNumber(node.degree)} edges`}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <p className="m-0 text-xs text-muted">Incoming plus outgoing edge records of every type.</p>
      </Section>

      <Section name="layers" title={grouped ? 'Layers' : 'Top-level directories'}>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {layers.map((layer) => (
            <li key={layer.key}>
              <button type="button" data-xv-layer={layer.key} data-xv-files={layer.files} onClick={() => onOpenLayer(layer.path)} className={ROW_BUTTON}>
                <span className="min-w-0 flex-1 truncate text-ink">{layer.label}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted">{`${formatNumber(layer.files)} file${layer.files === 1 ? '' : 's'}`}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section name="unused" title="Unused code">
        {unusedProduct && !readable(unusedProduct) ? <Unavailable product={unusedProduct} /> : null}
        {unusedFacts ? (
          <>
            <a href={UNUSED_HREF} data-xv-highlight="unused-total" data-xv-value={unusedFacts.total} className="text-[13px]">
              {`${formatNumber(unusedFacts.total)} unused function${unusedFacts.total === 1 ? '' : 's'}`}
            </a>
            <BarList rows={unusedFacts.byConfidence.map((row) => ({ key: row.key, label: row.label, value: row.count, colour: CONFIDENCE_COLOUR[row.key] }))} label="Unused functions by confidence" />
          </>
        ) : null}
        {unused.state === 'error' ? <p className="m-0 text-xs text-muted">{unused.error.message}</p> : null}
      </Section>

      <Section name="hotspots" title="Hotspots">
        {hotspotsProduct && !readable(hotspotsProduct) ? <Unavailable product={hotspotsProduct} /> : null}
        {hotFiles ? (hotFiles.length === 0 ? <p className="m-0 text-xs text-muted">No file has a score.</p> : (
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
            {hotFiles.map((file) => (
              <li key={file.path} className="flex min-w-0 items-center gap-2 px-1.5 py-0.5">
                <a href={file.href} data-xv-highlight="hot-file" data-xv-path={file.path} className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>{file.path}</a>
                <span className="shrink-0 font-mono text-[11px] text-muted">{`score ${formatNumber(file.score)}`}</span>
              </li>
            ))}
          </ol>
        )) : null}
        {hotspots.state === 'error' ? <p className="m-0 text-xs text-muted">{hotspots.error.message}</p> : null}
      </Section>

      {tourProduct?.status === 'included' ? (
        <button type="button" data-xv-action="start-tour" onClick={onStartTour} className="cursor-pointer self-start rounded-control border border-accent bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-violet">
          Start tour
        </button>
      ) : null}
    </div>
  );
}
