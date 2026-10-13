// #/node/<id>[?hops=2]: the graph explorer's symbol level (task 6.2), the
// node's 1- or 2-hop neighborhood over the CSR adjacency, above the node
// detail panel (task 6.3). An unknown id says so plainly.
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { cellText, isTable, type ViewData } from '../data';
import { fmtNumber, text } from '../format';
import { edgeTypeKey } from '../model/edge-types';
import type { EdgeGroup, NeighborhoodResult, NodeEdgesResult } from '../model/graph-model';
import { chunkTerms, edgeEvidence, evidenceLocation, nodeFacts, nodeRowIndex, type NodeFacts } from '../model/node-detail';
import { dirHash, graphDirHash, graphFileHash, nodeHash, sectionHash } from '../routes';
import { clearBusy, markBusy } from '../instrument';
import { EdgeLegend } from './EdgeLegend';
import { Breadcrumbs, GraphFrame, filterLinks, typeCounts, useLevelReport } from './Graph';
import { GraphCanvas, type CanvasLink, type CanvasNode } from './GraphCanvas';
import { runQuery, useCsr, useDisabledTypes } from './graph-state';

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
      return {
        key: str('id', r) ?? `row:${r}`,
        label: str('name', r) ?? str('id', r) ?? '?',
        size: 1,
        tone: d === 0 ? 'center' : d === 1 ? 'hop1' : 'hop2',
        tooltip: [str('id', r) ?? '', `${str('type', r) ?? '—'} · ${d === 0 ? 'this node' : `${d} ${d === 1 ? 'hop' : 'hops'} away`}`, ...(d === 0 ? [] : ['Click to open it'])],
        activatable: d !== 0,
      };
    });
    const merged = new Map<string, CanvasLink>();
    for (let i = 0; i < shownHood.edges.length; i += 4) {
      const k = `${shownHood.edges[i + 1]}>${shownHood.edges[i + 2]}>${shownHood.edges[i + 3]}`;
      const hit = merged.get(k);
      if (hit) hit.count += 1;
      else merged.set(k, { source: shownHood.edges[i + 1], target: shownHood.edges[i + 2], type: shownHood.types[shownHood.edges[i + 3]], count: 1 });
    }
    return { nodes, links: [...merged.values()], key: `node:${str('id', shownHood.row)}:${shownHood.hops}` };
  }, [shownHood, data]);
  const shownLinks = useMemo(() => (canvas ? filterLinks(canvas.links, disabled) : []), [canvas, disabled]);

  const groupsReport = currentEdges
    ? [...currentEdges.out.map((g) => `out:${g.type}=${g.total}`), ...currentEdges.in.map((g) => `in:${g.type}=${g.total}`)].join(',')
    : null;
  useLevelReport('symbol', id, currentHood ? currentHood.rows.length : null, {
    'data-selected-node': id,
    'data-detail-edges': groupsReport,
    'data-neighborhood-total': currentHood ? currentHood.total : null,
    'data-neighborhood-hops': hops,
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
            {canvas && <EdgeLegend counts={typeCounts(canvas.links)} disabled={disabled} onToggle={toggle} />}
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
            onActivate={(i) => {
              window.location.hash = nodeHash(canvas.nodes[i].key, hops);
            }}
            ariaLabel={`Neighborhood of ${id}: ${canvas.nodes.length} nodes, ${shownLinks.length} links`}
          />
        )}
        {currentHood && currentHood.total > currentHood.rows.length && (
          <p className="muted" data-graph-note="collapsed">
            Drawing the nearest {fmtNumber(currentHood.rows.length)} of {fmtNumber(currentHood.total)} nodes within {hops} {hops === 1 ? 'hop' : 'hops'} (breadth-first order).
          </p>
        )}
        {currentHood && currentHood.edgesTotal > currentHood.edges.length / 4 && (
          <p className="muted" data-graph-note="links">Drawing {fmtNumber(currentHood.edges.length / 4)} of {fmtNumber(currentHood.edgesTotal)} edges among them.</p>
        )}
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
      <EdgesCard data={data} edges={edges} />
    </div>
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
  const outTotal = edges.out.reduce((n, g) => n + g.total, 0);
  const inTotal = edges.in.reduce((n, g) => n + g.total, 0);
  return (
    <section className="card" data-edges-out={outTotal} data-edges-in={inTotal}>
      <h2>Edges</h2>
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
