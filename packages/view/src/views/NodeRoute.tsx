// #/node/<id>[?hops=2]: the graph explorer's symbol level (task 6.2), the
// node's 1- or 2-hop neighborhood over the CSR adjacency, above the node
// detail panel (task 6.3) with its source excerpt and each edge's evidence
// line text (task 7.1). An unknown id says so plainly.
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { cellText, isTable, type ViewData } from '../data';
import { fmtNumber, text } from '../format';
import { edgeTypeKey } from '../model/edge-types';
import type { EdgeGroup, NeighborhoodResult, NodeEdgesResult } from '../model/graph-model';
import { chunkTerms, edgeEvidence, evidenceLocation, nodeFacts, nodeRowIndex, type NodeFacts } from '../model/node-detail';
import { evidenceLineText, nodeExcerpt, reasonMessage } from '../model/source-text';
import { dirHash, graphDirHash, graphFileHash, nodeHash, sectionHash } from '../routes';
import { clearBusy, markBusy, report } from '../instrument';
import { EdgeLegend } from './EdgeLegend';
import { Breadcrumbs, GraphFrame, filterLinks, mergeEdges, moreCanvasLinks, moreNode, typeCounts, useLevelReport } from './Graph';
import { EdgeLedger } from './EdgeLedger';
import { bucketTotalsByType, ledgerReport, ledgerSums, neighborhoodReport } from '../model/edge-ledger';
import { GraphCanvas, type CanvasLink, type CanvasNode } from './GraphCanvas';
import { runQuery, useCsr, useDisabledTypes, useLayerColoring } from './graph-state';
import { SourceBlock } from './SourceBlock';
import { LayerLegend } from './LayerLegend';
import { Badge } from '../components/Badge';
import { layerColoring, layerModel, nodeLayerNames, nodeSummary, summaryTooltip } from '../model/semantics';

/** Evidence rows shown per edge in the detail. */
const EVIDENCE_PER_EDGE = 3;

export function findNodeRow(data: ViewData, id: string): number {
  return nodeRowIndex(data.segments, data.strings).get(id) ?? -1;
}

export function NodeRoute({ data, id, hops }: { data: ViewData; id: string; hops: number }) {
  const row = findNodeRow(data, id);
  if (row < 0 || !isTable(data.segments.nodes)) {
    return (
      <div className="content" data-section="node" data-node-found="false">
        <section className="card">
          <h2>Node not found</h2>
          <p>
            No node with id <code>{id}</code> is in this graph. <a href={sectionHash('overview')}>Back to the overview</a>.
          </p>
        </section>
      </div>
    );
  }
  return <NodeView data={data} id={id} row={row} hops={hops} />;
}

function NodeView({ data, id, row, hops }: { data: ViewData; id: string; row: number; hops: number }) {
  const csr = useCsr(data);
  const [disabled, toggle] = useDisabledTypes();
  const [coloring, toggleColoring] = useLayerColoring();
  const layers = useMemo(() => layerModel(data.segments, data.strings), [data]);
  const facts = useMemo(() => nodeFacts(data.segments, data.strings, row), [data, row]);
  const [hood, setHood] = useState<{ key: string; result: NeighborhoodResult } | null>(null);
  const [edges, setEdges] = useState<{ row: number; result: NodeEdgesResult } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const enabledTypes = useMemo(() => {
    if (csr.state !== 'ready' || disabled.size === 0) return null;
    return csr.result.types.filter((t) => !disabled.has(edgeTypeKey(t)));
  }, [csr, disabled]);
  const hoodKey = `node:${id}:${hops}:${enabledTypes === null ? '*' : enabledTypes.join(',')}`;

  useEffect(() => {
    if (csr.state !== 'ready') return;
    let live = true;
    runQuery<NeighborhoodResult>(data, `hood:${hoodKey}`, { op: 'neighborhood', row, hops, types: enabledTypes }).then(
      (result) => live && setHood({ key: hoodKey, result }),
      (error: unknown) => live && setFailure(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [csr.state, data, row, hops, hoodKey]);

  useEffect(() => {
    if (csr.state !== 'ready') return;
    let live = true;
    runQuery<NodeEdgesResult>(data, `edges:${row}`, { op: 'node-edges', row }).then(
      (result) => live && setEdges({ row, result }),
      (error: unknown) => live && setFailure(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [csr.state, data, row]);

  const currentHood = hood?.key === hoodKey ? hood.result : null;
  const currentEdges = edges?.row === row ? edges.result : null;
  useEffect(() => {
    const busyKey = 'node-view';
    if (currentHood && currentEdges) clearBusy(busyKey);
    else markBusy(busyKey);
    return () => clearBusy(busyKey);
  }, [currentHood, currentEdges]);

  // The neighborhood the canvas shows (the previous one until the new one arrives).
  const shownHood = hood?.result ?? null;
  const canvas = useMemo(() => {
    if (!shownHood) return null;
    const table = data.segments.nodes;
    const str = (column: string, r: number) => (isTable(table) ? cellText(data.strings, table.columns[column]?.[r] ?? -1) : undefined);
    const nodes: CanvasNode[] = shownHood.rows.map((r, i) => {
      const d = shownHood.distance[i];
      const nodeId = str('id', r) ?? '';
      const summary = summaryTooltip(data.segments, nodeId);
      const layerNames = layers ? nodeLayerNames(layers, nodeId) : [];
      return {
        key: str('id', r) ?? `row:${r}`,
        label: str('name', r) ?? str('id', r) ?? '?',
        size: 1,
        tone: d === 0 ? 'center' : d === 1 ? 'hop1' : 'hop2',
        tooltip: [
          nodeId,
          `${str('type', r) ?? '—'} · ${d === 0 ? 'this node' : `${d} ${d === 1 ? 'hop' : 'hops'} away`}`,
          ...(summary ? [summary] : []),
          ...(layerNames.length > 0 ? [`Layer: ${layerNames.join(', ')}${layers?.stale ? ' (stale)' : ''}`] : []),
          ...(d === 0 ? [] : ['Click to open it']),
        ],
        activatable: d !== 0,
      };
    });
    if (shownHood.folded > 0) nodes.push(moreNode(shownHood.folded, 'nodes within reach', 'nodes past each hop\'s share'));
    const links: CanvasLink[] = [...mergeEdges(shownHood.edges, shownHood.types), ...moreCanvasLinks(shownHood.moreLinks, shownHood.types)];
    return { nodes, links, key: `node:${str('id', shownHood.row)}:${shownHood.hops}` };
  }, [shownHood, data, layers]);
  const colored = useMemo(() => (canvas && layers && coloring ? layerColoring(layers, canvas.nodes.map((n) => (n.tone === 'more' ? null : n.key))) : null), [canvas, layers, coloring]);
  const ledger = useMemo(() => (currentHood ? ledgerSums(currentHood.buckets) : null), [currentHood]);
  const shownLinks = useMemo(() => (canvas ? filterLinks(canvas.links, disabled) : []), [canvas, disabled]);

  const groupsReport = currentEdges
    ? [...currentEdges.out.map((g) => `out:${g.type}=${g.total}`), ...currentEdges.in.map((g) => `in:${g.type}=${g.total}`)].join(',')
    : null;
  useLevelReport('symbol', id, currentHood ? currentHood.rows.length + (currentHood.folded > 0 ? 1 : 0) : null, {
    'data-selected-node': id,
    'data-detail-edges': groupsReport,
    'data-neighborhood-total': currentHood ? currentHood.total : null,
    'data-neighborhood-hops': hops,
    ...neighborhoodReport(currentHood),
    ...ledgerReport(ledger),
  });

  return (
    <div className="content" data-section="node" data-node-found="true" data-graph-level="symbol">
      <GraphFrame
        title={`Neighborhood within ${hops} ${hops === 1 ? 'hop' : 'hops'}`}
        crumbs={<Breadcrumbs kind="symbol" path={facts.path ?? ''} tail={facts.name ?? id} />}
        csr={csr}
        legend={
          <div className="toolbar">
            <span className="hop-switch" role="group" aria-label="Hops">
              {[1, 2].map((h) => (h === hops ? <strong key={h} data-hops={h}>{h} {h === 1 ? 'hop' : 'hops'}</strong> : <a key={h} href={nodeHash(id, h)} data-hops={h}>{h} {h === 1 ? 'hop' : 'hops'}</a>))}
            </span>
            {canvas && shownHood && <EdgeLegend drawn={typeCounts(canvas.links)} totals={bucketTotalsByType(shownHood.types, shownHood.buckets)} disabled={disabled} onToggle={toggle} />}
            <LayerLegend model={layers} on={coloring} onToggle={toggleColoring} colored={colored?.perLayer ?? new Map()} unlayered={colored?.unlayered ?? 0} aggregates={0} />
          </div>
        }
      >
        {failure && <p className="bad-text">The neighborhood could not be computed: {failure}</p>}
        {csr.state === 'ready' && !currentHood && !failure && <p className="muted">Computing the neighborhood…</p>}
        {canvas && (
          <GraphCanvas
            level={canvas.key}
            nodes={canvas.nodes}
            links={shownLinks}
            selectedKey={id}
            nodeColors={colored?.colors ?? null}
            onActivate={(i) => {
              window.location.hash = nodeHash(canvas.nodes[i].key, hops);
            }}
            ariaLabel={`Neighborhood of ${id}: ${canvas.nodes.length} nodes, ${shownLinks.length} links`}
          />
        )}
        {currentHood && currentHood.folded > 0 && (
          <p className="muted" data-graph-note="collapsed">
            {fmtNumber(currentHood.total)} nodes within {hops} {hops === 1 ? 'hop' : 'hops'}; drawing{' '}
            {currentHood.hopTotals.slice(1).map((n, i) => `${fmtNumber(currentHood.hopDrawn[i + 1])} of ${fmtNumber(n)} at ${i + 1} ${i === 0 ? 'hop' : 'hops'}`).join(' and ')}{' '}
            (each hop past the first keeps at least a quarter of the room), the other {fmtNumber(currentHood.folded)} are folded into one "more" node.
          </p>
        )}
        {currentHood && currentHood.edgesTotal > currentHood.edges.length / 4 && (
          <p className="muted" data-graph-note="links">Drawing {fmtNumber(currentHood.edges.length / 4)} of {fmtNumber(currentHood.edgesTotal)} edges among the drawn nodes.</p>
        )}
        {ledger && <EdgeLedger sums={ledger} scope={`to nodes beyond ${hops} ${hops === 1 ? 'hop' : 'hops'}`} />}
      </GraphFrame>
      <motion.div key={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} data-motion="panel">
        <NodeDetail data={data} id={id} row={row} facts={facts} edges={currentEdges} />
      </motion.div>
    </div>
  );
}

function parentDir(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

function NodeDetail({ data, id, row, facts, edges }: { data: ViewData; id: string; row: number; facts: NodeFacts; edges: NodeEdgesResult | null }) {
  const terms = useMemo(() => chunkTerms(data.segments, data.strings, data.meta, row), [data, row]);
  // Evidence lines of this node's out-edges that fall inside its excerpt.
  const highlight = useMemo(() => {
    const lines = new Set<number>();
    if (!edges || facts.path === null) return lines;
    for (const group of edges.out) {
      for (let i = 0; i < group.edges.length; i += 2) {
        for (const ev of edgeEvidence(data.segments, data.strings, group.edges[i], EVIDENCE_PER_EDGE).rows) {
          if (ev.file === facts.path && ev.line >= facts.line0 && ev.line <= facts.line1) lines.add(ev.line);
        }
      }
    }
    return lines;
  }, [edges, data, facts]);
  const dir = facts.path === null ? null : parentDir(facts.path);
  return (
    <div className="detail" data-node-detail={id}>
      <div className="grid-2">
        <section className="card">
          <h2 className="mono">{id}</h2>
          <dl className="facts">
            <dt>Type</dt>
            <dd>{text(facts.type)}</dd>
            <dt>Name</dt>
            <dd>{text(facts.name)}</dd>
            <dt>Path</dt>
            <dd className="mono">
              {facts.path === null ? '—' : (
                <>
                  {facts.path} <a href={graphFileHash(facts.path)} data-link="graph-file">symbols</a> · <a href={dirHash(facts.path)} data-link="structure-file">structure</a>
                </>
              )}
            </dd>
            <dt>Directory</dt>
            <dd className="mono">
              {dir === null ? '—' : (
                <>
                  {dir === '' ? '(top)' : `${dir}/`} <a href={graphDirHash(dir)} data-link="graph-dir">graph</a> · <a href={dirHash(dir)} data-link="structure-dir">structure</a>
                </>
              )}
            </dd>
            <dt>Lines</dt>
            <dd>{facts.line0 >= 0 ? `${fmtNumber(facts.line0)}–${fmtNumber(facts.line1)}` : '—'}</dd>
            <dt>Owner</dt>
            <dd className="mono">{text(facts.owner)}</dd>
            <dt>Complexity</dt>
            <dd>{text(facts.complexity)}</dd>
            <dt>Anchor source</dt>
            <dd>{text(facts.anchorSource)}</dd>
          </dl>
        </section>
        <TermsCard terms={terms} />
      </div>
      <SummaryCard data={data} id={id} />
      <section className="card" data-excerpt={id}>
        <h2>Source</h2>
        {facts.line0 < 0 ? (
          <p className="muted" data-source="no-line-range">This node has no line range, so there is no excerpt.</p>
        ) : (
          <SourceBlock source={nodeExcerpt(data.meta, data.segments, row, facts.path)} startLine={facts.line0} highlight={highlight} />
        )}
      </section>
      <EdgesCard data={data} edges={edges} />
    </div>
  );
}

/** The node's cached summary and tags with the bake's freshness verdict, and its layers (tasks 8.1, 8.2). */
function SummaryCard({ data, id }: { data: ViewData; id: string }) {
  const summary = nodeSummary(data.meta, data.segments, id);
  const layers = layerModel(data.segments, data.strings);
  const layerNames = layers ? nodeLayerNames(layers, id) : null;
  const state = summary.state === 'entry' ? summary.badge.state : summary.state;
  useEffect(() => {
    report('data-semantics-node-summary', state);
    report('data-semantics-node-layers', layerNames === null ? null : layerNames.length === 0 ? 'unlayered' : layerNames.join(','));
    return () => {
      report('data-semantics-node-summary', null);
      report('data-semantics-node-layers', null);
    };
  }, [state, layerNames?.join(',')]);
  return (
    <section className="card" data-node-summary={state}>
      <h2>Summary</h2>
      {summary.state === 'not-generated' && (
        <p className="muted">
          <Badge state="not-generated">Not generated</Badge> <span className="mono">{summary.command}</span>
        </p>
      )}
      {summary.state === 'invalid' && (
        <p>
          <Badge state="invalid">Invalid</Badge> semantic-cache.json could not be read: {summary.reason}
        </p>
      )}
      {summary.state === 'none' && <p className="muted">Not summarized: the semantic cache has no entry for this node.</p>}
      {summary.state === 'entry' && (
        <>
          <p>
            <Badge state={summary.badge.state}>{summary.badge.label}</Badge>
            {summary.badge.state === 'stale' && <span className="secondary"> The file changed after this summary was written.</span>}
          </p>
          <p className="summary-text">{text(summary.entry.summary)}</p>
          {summary.entry.tags.length > 0 && (
            <ul className="tag-list">
              {summary.entry.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
          <p className="muted">
            Model {text(summary.entry.model)} · generated {text(summary.entry.generatedAt)}
            {summary.entry.verification !== null && summary.entry.verification !== undefined && <> · verification {text(summary.entry.verification)}</>}
          </p>
        </>
      )}
      {layerNames !== null && (
        <p className="secondary" data-node-layers={layerNames.length === 0 ? 'unlayered' : layerNames.join(',')}>
          Layer: {layerNames.length === 0 ? 'unlayered' : layerNames.join(', ')}
          {layers?.stale && ' (the semantic graph is stale)'}
        </p>
      )}
    </section>
  );
}

function TermsCard({ terms }: { terms: ReturnType<typeof chunkTerms> }) {
  if (terms.state === 'no-index') {
    return (
      <section className="card" data-terms="not-available">
        <h2>Source-index terms</h2>
        <p className="muted">Not available: this page was baked without a source index (source-index.jsonl was missing).</p>
      </section>
    );
  }
  if (terms.state === 'no-chunk') {
    return (
      <section className="card" data-terms="no-chunk">
        <h2>Source-index terms</h2>
        <p className="muted">The source index has no chunk for this node.</p>
      </section>
    );
  }
  const literal = (label: string, list: string[] | null, key: string) => (
    <>
      <h3>
        {label} {list !== null && <span className="muted">({fmtNumber(list.length)})</span>}
      </h3>
      {list === null ? (
        <p className="muted" data-terms-literals={key} data-state="not-embedded">
          Not embedded ({terms.literals.label}).
        </p>
      ) : list.length === 0 ? (
        <p className="muted" data-terms-literals={key} data-state="empty">None.</p>
      ) : (
        <ul className="term-list" data-terms-literals={key} data-state="embedded">
          {list.map((t, i) => (
            <li key={i} className="mono">{t}</li>
          ))}
        </ul>
      )}
    </>
  );
  return (
    <section className="card" data-terms="chunk" data-identifiers={terms.identifiers.length}>
      <h2>Source-index terms</h2>
      <h3>
        Identifiers <span className="muted">({fmtNumber(terms.identifiers.length)})</span>
      </h3>
      <p className="mono term-cloud">{terms.identifiers.length === 0 ? '—' : terms.identifiers.join(' ')}</p>
      {literal('Comments', terms.comments, 'comments')}
      {literal('String literals', terms.strings, 'strings')}
    </section>
  );
}

function EdgesCard({ data, edges }: { data: ViewData; edges: NodeEdgesResult | null }) {
  if (!edges) {
    return (
      <section className="card">
        <h2>Edges</h2>
        <p className="muted">Loading edges…</p>
      </section>
    );
  }
  const evidenceEntry = (data.meta.embeds ?? []).find((e) => e.segment === 'evidenceText');
  const dropped = (data.meta.dropped ?? []).find((d) => d.segment === 'evidenceText');
  const pageReason = dropped?.reason === 'no-source' || dropped?.reason === 'budget' || dropped?.reason === 'drop-mode' ? dropped.reason : evidenceEntry?.status === 'embedded' ? null : 'not-recorded';
  const outTotal = edges.out.reduce((n, g) => n + g.total, 0);
  const inTotal = edges.in.reduce((n, g) => n + g.total, 0);
  return (
    <section className="card" data-edges-out={outTotal} data-edges-in={inTotal}>
      <h2>Edges</h2>
      {pageReason !== null && (
        <p className="source-missing" data-source="not-embedded" data-source-reason={pageReason}>
          {reasonMessage(data.meta, 'evidenceText', pageReason)} Evidence keeps its file and line.
        </p>
      )}
      <div className="grid-2">
        <div>
          <h3>Outgoing ({fmtNumber(outTotal)})</h3>
          {edges.out.length === 0 && <p className="muted">None.</p>}
          {edges.out.map((g) => (
            <EdgeGroupList key={g.type} data={data} group={g} direction="out" />
          ))}
          {edges.unresolvedOut.length > 0 && <Unresolved data={data} rows={edges.unresolvedOut} direction="out" />}
        </div>
        <div>
          <h3>Incoming ({fmtNumber(inTotal)})</h3>
          {edges.in.length === 0 && <p className="muted">None.</p>}
          {edges.in.map((g) => (
            <EdgeGroupList key={g.type} data={data} group={g} direction="in" />
          ))}
          {edges.unresolvedIn.length > 0 && <Unresolved data={data} rows={edges.unresolvedIn} direction="in" />}
        </div>
      </div>
    </section>
  );
}

function EdgeGroupList({ data, group, direction }: { data: ViewData; group: EdgeGroup; direction: 'out' | 'in' }) {
  const table = data.segments.nodes;
  const str = (column: string, r: number) => (isTable(table) ? cellText(data.strings, table.columns[column]?.[r] ?? -1) : undefined);
  const items: Array<{ edge: number; peer: number }> = [];
  for (let i = 0; i < group.edges.length; i += 2) items.push({ edge: group.edges[i], peer: group.edges[i + 1] });
  return (
    <div className="edge-group" data-edge-group={`${direction}:${group.type}`} data-total={group.total}>
      <h4>
        <span className="swatch" style={{ background: `var(--edge-${edgeTypeKey(group.type)})` }} /> {group.type}{' '}
        <span className="muted">
          {direction === 'out' ? '→' : '←'} {fmtNumber(group.total)}
        </span>
      </h4>
      <ul className="edge-list">
        {items.map(({ edge, peer }) => {
          const peerId = str('id', peer) ?? '';
          const ev = edgeEvidence(data.segments, data.strings, edge, EVIDENCE_PER_EDGE);
          return (
            <li key={edge} data-edge={edge}>
              <a href={nodeHash(peerId)} data-peer={peerId}>
                {str('name', peer) ?? peerId}
              </a>{' '}
              <span className="muted">{str('type', peer) ?? '—'}</span>
              {ev.total === 0 && <div className="muted">No evidence recorded.</div>}
              {ev.rows.map((e) => (
                <div key={e.row} className="evidence" data-evidence={e.row}>
                  <span className="mono muted">{evidenceLocation(e)}</span>
                  {e.line >= 0 && <SourceBlock source={evidenceLineText(data.meta, data.segments, e.row, e.file)} startLine={e.line} highlight={new Set([e.line])} compact />}
                </div>
              ))}
              {ev.total > ev.rows.length && <div className="muted">+{fmtNumber(ev.total - ev.rows.length)} more evidence</div>}
            </li>
          );
        })}
      </ul>
      {group.total > items.length && <p className="muted">Showing {fmtNumber(items.length)} of {fmtNumber(group.total)}.</p>}
    </div>
  );
}

function Unresolved({ data, rows, direction }: { data: ViewData; rows: number[]; direction: 'out' | 'in' }) {
  const edges = data.segments.edges;
  const str = (column: string, e: number) => (isTable(edges) ? cellText(data.strings, edges.columns[column]?.[e] ?? -1) : undefined);
  return (
    <div className="edge-group" data-edge-group={`${direction}:unresolved`} data-total={rows.length}>
      <h4>
        Endpoint not in the graph <span className="muted">{fmtNumber(rows.length)}</span>
      </h4>
      <ul className="edge-list">
        {rows.slice(0, 100).map((e) => (
          <li key={e} className="mono">
            {str('type', e) ?? '(untyped)'} {direction === 'out' ? '→' : '←'} {str(direction === 'out' ? 'dst' : 'src', e) ?? '(no id)'}
          </li>
        ))}
      </ul>
    </div>
  );
}
