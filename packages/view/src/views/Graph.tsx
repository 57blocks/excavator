// Graph explorer (artifact-view task 6.2), drilled into one level at a time:
// member (`#/graph`) -> directory (`#/graph/<dir>`) -> file
// (`#/graph/file/<path>`) -> symbol (`#/node/<id>`, see NodeRoute). Each
// level is answered by the data Worker over the CSR adjacency, which is built
// on the first visit (with progress), never on the ready path.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cellText, isTable, type ViewData } from '../data';
import { fmtNumber } from '../format';
import { edgeTypeKey } from '../model/edge-types';
import type { FileViewResult, GraphItem, GraphViewResult } from '../model/graph-model';
import { graphDirHash, graphFileHash, nodeHash } from '../routes';
import { clearBusy, markBusy, report } from '../instrument';
import { EdgeLegend } from './EdgeLegend';
import { EdgeLedger } from './EdgeLedger';
import { bucketTotalsByType, ledgerReport, ledgerSums } from '../model/edge-ledger';
import { GraphCanvas, type CanvasLink, type CanvasNode } from './GraphCanvas';
import { runQuery, useCsr, useDisabledTypes, useLayerColoring, type CsrState } from './graph-state';
import { LayerLegend } from './LayerLegend';
import { layerColoring, layerModel, nodeLayerNames, summaryTooltip } from '../model/semantics';
import { itemVisual, symbolVisual } from '../model/graph-visual';
import { visualData } from './visual-data';
import { NodeLegend } from './NodeLegend';

export type GraphLevel = { kind: 'member'; path: '' } | { kind: 'directory'; path: string } | { kind: 'file'; path: string };

export type LevelName = 'member' | 'directory' | 'file' | 'symbol';

/** Self-report of the level on #root, removed when the explorer goes away. */
export function useLevelReport(level: LevelName, path: string, visible: number | null, extra: Record<string, string | number | null> = {}) {
  const extraKey = JSON.stringify(extra);
  useEffect(() => {
    report('data-graph-level', level);
    report('data-graph-path', path);
    report('data-graph-visible-nodes', visible);
    for (const [k, v] of Object.entries(extra)) report(k, v);
  }, [level, path, visible, extraKey]);
  useEffect(
    () => () => {
      for (const name of ['data-graph-level', 'data-graph-path', 'data-graph-visible-nodes', 'data-graph-transform', 'data-graph-canvas-level', ...Object.keys(extra)]) report(name, null);
    },
    [],
  );
}

function crumbsFor(kind: LevelName, path: string): Array<{ label: string; href: string | null }> {
  const crumbs: Array<{ label: string; href: string | null }> = [{ label: 'Graph', href: '#/graph' }];
  if (path === '' || kind === 'member') return crumbs;
  const parts = path.split('/');
  const dirParts = kind === 'directory' ? parts : parts.slice(0, -1);
  dirParts.forEach((part, i) => crumbs.push({ label: `${part}/`, href: graphDirHash(dirParts.slice(0, i + 1).join('/')) }));
  if (kind !== 'directory') crumbs.push({ label: parts[parts.length - 1], href: graphFileHash(path) });
  return crumbs;
}

export function Breadcrumbs({ kind, path, tail }: { kind: LevelName; path: string; tail?: string }) {
  const crumbs = crumbsFor(kind, path);
  if (tail !== undefined) crumbs.push({ label: tail, href: null });
  return (
    <nav className="crumbs" aria-label="Graph level" data-graph-crumbs={crumbs.length}>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i}>
            {i > 0 && <span className="muted"> / </span>}
            {last || c.href === null ? <strong data-graph-crumb={i}>{c.label}</strong> : <a href={c.href} data-graph-crumb={i}>{c.label}</a>}
          </span>
        );
      })}
    </nav>
  );
}

export function CsrProgress({ csr }: { csr: CsrState }) {
  if (csr.state === 'ready') return null;
  if (csr.state === 'error') return <p className="bad-text">The adjacency index could not be built: {csr.message}</p>;
  const pct = csr.state === 'building' && csr.total > 0 ? (csr.done / csr.total) * 100 : 0;
  return (
    <div data-csr-progress={Math.round(pct)}>
      <p className="muted">Building the adjacency index (first graph view only)… {Math.round(pct)}%</p>
      <div className="funnel-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Per-type counts of a level's links, for the legend. */
export function typeCounts(links: Array<{ type: string; count: number }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of links) counts.set(l.type, (counts.get(l.type) ?? 0) + l.count);
  return counts;
}

/** One canvas link per (source, target, type) from flat [edge row, source, target, type] quads. */
export function mergeEdges(edges: number[], types: string[]): CanvasLink[] {
  const merged = new Map<string, CanvasLink>();
  for (let i = 0; i < edges.length; i += 4) {
    const k = `${edges[i + 1]}>${edges[i + 2]}>${edges[i + 3]}`;
    const hit = merged.get(k);
    if (hit) hit.count += 1;
    else merged.set(k, { source: edges[i + 1], target: edges[i + 2], type: types[edges[i + 3]], count: 1 });
  }
  return [...merged.values()];
}

/** Canvas links to and from the "more" item, from flat [source, target, type, count] quads. */
export function moreCanvasLinks(moreLinks: number[], types: string[]): CanvasLink[] {
  const links: CanvasLink[] = [];
  for (let i = 0; i < moreLinks.length; i += 4) links.push({ source: moreLinks[i], target: moreLinks[i + 1], type: types[moreLinks[i + 2]], count: moreLinks[i + 3] });
  return links;
}

/** The "more" node of a symbol-level view: `folded` nodes not drawn. */
export function moreNode(folded: number, what: string, which: string): CanvasNode {
  return {
    key: 'more',
    kind: 'more',
    label: `${fmtNumber(folded)} more`,
    size: folded,
    tone: 'more',
    tooltip: [`${fmtNumber(folded)} more ${what}`, `The ${which}, folded to stay within 400 drawn nodes`, 'Their edges to drawn nodes are the links to this node'],
    activatable: false,
  };
}

export function filterLinks<T extends { type: string }>(links: T[], disabled: ReadonlySet<string>): T[] {
  return disabled.size === 0 ? links : links.filter((l) => !disabled.has(edgeTypeKey(l.type)));
}

export function GraphFrame({ title, crumbs, csr, legend, children }: { title: string; crumbs: ReactNode; csr: CsrState; legend: ReactNode; children: ReactNode }) {
  return (
    <section className="card graph-card">
      <div className="toolbar">
        {crumbs}
        <span className="muted">{title}</span>
      </div>
      <CsrProgress csr={csr} />
      {legend}
      {children}
    </section>
  );
}

function sumTypes(byType: number[]): number {
  return byType.reduce((n, c) => n + c, 0);
}

function itemTooltip(item: GraphItem, files: number | null, language: string | null): string[] {
  const lines = [item.kind === 'dir' ? `${item.path}/` : item.kind === 'file' ? item.path : item.label];
  lines.push(`${fmtNumber(item.nodes)} nodes · ${fmtNumber(item.internal)} edges inside${files !== null ? ` · ${fmtNumber(files)} files` : ''}${item.kind === 'file' ? ` · ${language ?? 'language unknown'}` : ''}`);
  if (item.kind === 'dir') lines.push('Click to open this directory');
  else if (item.kind === 'file') lines.push('Click to open its symbols');
  else if (item.kind === 'more') lines.push(`The ${fmtNumber(item.folded ?? 0)} lightest items, folded to stay within 400 drawn nodes`);
  else lines.push('Nodes without a path');
  return lines;
}

export function Graph({ data, level }: { data: ViewData; level: GraphLevel }) {
  const csr = useCsr(data);
  const [disabled, toggle] = useDisabledTypes();
  const [coloring, toggleColoring] = useLayerColoring();
  const layers = useMemo(() => layerModel(data.segments, data.strings), [data]);
  const [view, setView] = useState<{ key: string; result: GraphViewResult | FileViewResult } | { key: string; error: string } | null>(null);
  const key = `${level.kind}:${level.path}`;

  useEffect(() => {
    if (csr.state !== 'ready') return;
    let live = true;
    const query = level.kind === 'file' ? ({ op: 'graph-file', path: level.path } as const) : ({ op: 'graph-view', scope: level.kind === 'member' ? null : level.path } as const);
    runQuery<GraphViewResult | FileViewResult>(data, `graph:${key}`, query).then(
      (result) => live && setView({ key, result }),
      (error: unknown) => live && setView({ key, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, [csr.state, data, key]);

  // The previous level stays on screen until the new one arrives, so the
  // canvas can fade it out and expand the new one from the clicked node.
  const current = view?.key === key ? view : null;
  const result = view && 'result' in view ? view.result : null;
  useEffect(() => {
    const busyKey = 'graph-level';
    if (current) clearBusy(busyKey);
    else markBusy(busyKey);
    return () => clearBusy(busyKey);
  }, [current]);
  const members = useMemo(() => new Set((data.meta.members ?? []).map((m) => m.name)), [data]);
  const visual = visualData(data);

  const model = useMemo(() => {
    if (!result) return null;
    if ('items' in result && result.found) {
      const nodes: CanvasNode[] = result.items.map((item) => {
        const tone = item.kind === 'dir' ? (members.has(item.path) ? 'member' : 'dir') : item.kind === 'file' ? 'file' : item.kind;
        const look = itemVisual(tone, item.path, visual.structure, visual.colors);
        return {
          key: item.key,
          label: item.label,
          size: item.nodes,
          tone,
          tooltip: itemTooltip(item, look.badge, look.language),
          activatable: item.kind === 'dir' || item.kind === 'file',
          kind: look.kind,
          fill: look.fill,
          ring: look.ring,
          badge: look.badge,
        };
      });
      const links: CanvasLink[] = result.links.map((l) => ({ source: l.source, target: l.target, type: result.types[l.type], count: l.count }));
      // A file item is one graph node (its file node); a directory is an aggregate.
      const table = data.segments.nodes;
      const ids = result.items.map((item) => (item.kind === 'file' && item.fileRow !== undefined && isTable(table) ? (cellText(data.strings, table.columns.id?.[item.fileRow] ?? -1) ?? null) : null));
      return { nodes, links, ids, found: true as const };
    }
    if ('rows' in result && result.found) {
      const table = data.segments.nodes;
      const str = (column: string, row: number) => (isTable(table) ? cellText(data.strings, table.columns[column]?.[row] ?? -1) : undefined);
      const nodes: CanvasNode[] = result.rows.map((row) => {
        const line0 = isTable(table) ? (table.columns.line0?.[row] ?? -1) : -1;
        const nodeId = str('id', row) ?? '';
        const summary = summaryTooltip(data.segments, nodeId);
        const layerNames = layers ? nodeLayerNames(layers, nodeId) : [];
        const look = symbolVisual(str('type', row) ?? null, str('path', row) ?? null, visual.structure, visual.colors);
        return {
          key: str('id', row) ?? `row:${row}`,
          label: str('name', row) ?? str('id', row) ?? '?',
          size: 1,
          tone: 'symbol',
          kind: look.kind,
          fill: look.fill,
          tooltip: [
            nodeId,
            `${str('type', row) ?? '—'}${line0 >= 0 ? ` · line ${line0}` : ''}`,
            ...(summary ? [summary] : []),
            ...(layerNames.length > 0 ? [`Layer: ${layerNames.join(', ')}${layers?.stale ? ' (stale)' : ''}`] : []),
            'Click to open its neighborhood and detail',
          ],
          activatable: true,
        };
      });
      if (result.folded > 0) nodes.push(moreNode(result.folded, 'symbols', 'with the fewest edges'));
      const links = [...mergeEdges(result.edges, result.types), ...moreCanvasLinks(result.moreLinks, result.types)];
      return { nodes, links, ids: nodes.map((n) => (n.tone === 'more' ? null : n.key)), found: true as const };
    }
    return { nodes: [], links: [], ids: [], found: false as const };
  }, [result, data, members, layers, visual]);
  const colored = useMemo(() => (model?.found && layers && coloring ? layerColoring(layers, model.ids) : null), [model, layers, coloring]);

  const shownLinks = useMemo(() => (model ? filterLinks(model.links, disabled) : []), [model, disabled]);
  const ledger = useMemo(() => (current && result && result.found ? ledgerSums(result.buckets) : null), [current, result]);
  const levelName: LevelName = level.kind;
  useLevelReport(levelName, level.path, current && model?.found ? model.nodes.length : null, {
    'data-graph-items-total': result && 'itemsTotal' in result && result.found ? result.itemsTotal : result && 'total' in result ? result.total : null,
    'data-graph-links': model?.found ? shownLinks.length : null,
    ...ledgerReport(ledger),
  });

  const activate = (index: number) => {
    if (!result || !model) return;
    if ('items' in result && result.found) {
      const item = result.items[index];
      if (item.kind === 'dir') window.location.hash = graphDirHash(item.path);
      else if (item.kind === 'file') window.location.hash = graphFileHash(item.path);
    } else window.location.hash = nodeHash(model.nodes[index].key);
  };

  const title = level.kind === 'member' ? 'Member repositories and top-level directories' : level.kind === 'directory' ? 'Subdirectories and files' : 'Symbols in this file and the edges between them';
  const failed = current && 'error' in current ? current.error : null;

  return (
    <div className="content" data-section="graph" data-graph-level={levelName} data-graph-found={model ? String(model.found) : undefined}>
      <GraphFrame
        title={title}
        crumbs={<Breadcrumbs kind={levelName} path={level.path} />}
        csr={csr}
        legend={
          model?.found ? (
            <>
              <NodeLegend nodes={model.nodes} />
              <EdgeLegend drawn={typeCounts(shownLinks)} totals={result && result.found ? bucketTotalsByType(result.types, result.buckets) : new Map()} disabled={disabled} onToggle={toggle} />
              <LayerLegend
                model={layers}
                on={coloring}
                onToggle={toggleColoring}
                colored={colored?.perLayer ?? new Map()}
                unlayered={colored?.unlayered ?? 0}
                aggregates={colored?.aggregates ?? 0}
              />
            </>
          ) : null
        }
      >
        {failed && <p className="bad-text">This level could not be computed: {failed}</p>}
        {csr.state === 'ready' && !current && !failed && <p className="muted">Computing this level…</p>}
        {current && model && !model.found && (
          <p data-graph-missing={level.path}>
            No {level.kind === 'file' ? 'file' : 'directory'} <code>{level.path}</code> holds any node of this graph. <a href="#/graph">Back to the top</a>.
          </p>
        )}
        {model?.found && (
          <GraphCanvas
            level={view?.key ?? key}
            nodes={model.nodes}
            links={shownLinks}
            selectedKey={null}
            nodeColors={colored?.colors ?? null}
            onActivate={activate}
            ariaLabel={`${title}: ${model.nodes.length} nodes, ${shownLinks.length} links`}
          />
        )}
      </GraphFrame>
      {model?.found && result && <LevelNotes result={result} shownLinks={shownLinks.length} />}
      {model?.found && result && <ItemTable data={data} result={result} model={model} />}
    </div>
  );
}

function LevelNotes({ result, shownLinks }: { result: GraphViewResult | FileViewResult; shownLinks: number }) {
  const notes: Array<{ key: string; text: string }> = [];
  if ('items' in result && result.found) {
    if (result.itemsTotal > result.items.length) {
      notes.push({ key: 'collapsed', text: `${fmtNumber(result.itemsTotal)} items here; the lightest ${fmtNumber(result.itemsTotal - result.items.length + 1)} are folded into one "more" node to stay within 400 drawn nodes.` });
    }
    if (result.linksTotal > result.links.length) notes.push({ key: 'links', text: `Drawing the ${fmtNumber(result.links.length)} heaviest of ${fmtNumber(result.linksTotal)} aggregated links.` });
    if (result.level === 'directory') {
      notes.push({ key: 'outside', text: `${fmtNumber(sumTypes(result.outsideOut))} edges leave this directory and ${fmtNumber(sumTypes(result.outsideIn))} enter it (not drawn).` });
    }
    if (result.unresolvedEdges > 0) notes.push({ key: 'unresolved', text: `${fmtNumber(result.unresolvedEdges)} edges of the graph have an endpoint that is not a node and are not drawn at any level.` });
  } else if ('rows' in result && result.found) {
    if (result.folded > 0) {
      notes.push({ key: 'collapsed', text: `${fmtNumber(result.total)} symbols here; drawing the ${fmtNumber(result.rows.length)} with the most edges, the other ${fmtNumber(result.folded)} are folded into one "more" node to stay within 400 drawn nodes.` });
    }
    if (result.edgesTotal > result.edges.length / 4) notes.push({ key: 'links', text: `Drawing ${fmtNumber(result.edges.length / 4)} of ${fmtNumber(result.edgesTotal)} edges between drawn symbols.` });
    notes.push({ key: 'outside', text: `${fmtNumber(sumTypes(result.outsideOut))} edges leave these symbols for other files and ${fmtNumber(sumTypes(result.outsideIn))} arrive from them (not drawn); the file node's own edges to other files are on its node page.` });
  }
  notes.push({ key: 'shown', text: `${fmtNumber(shownLinks)} links drawn with the current edge type switches.` });
  const scope = 'items' in result && result.level === 'member' ? 'outside the graph' : 'items' in result ? 'leaving or entering this directory' : 'to or from other files';
  return (
    <section className="banner" data-state="fresh">
      <div>
        {notes.map((n) => (
          <div key={n.key} className="secondary" data-graph-note={n.key}>
            {n.text}
          </div>
        ))}
        {result.found && <EdgeLedger sums={ledgerSums(result.buckets)} scope={scope} />}
      </div>
    </section>
  );
}

function ItemTable({ data, result, model }: { data: ViewData; result: GraphViewResult | FileViewResult; model: { nodes: CanvasNode[] } }) {
  const fileId = (row: number | undefined) => {
    const table = data.segments.nodes;
    return row !== undefined && isTable(table) ? cellText(data.strings, table.columns.id?.[row] ?? -1) : undefined;
  };
  return (
    <section className="card">
      <details>
        <summary>Nodes in this view ({fmtNumber(model.nodes.length)})</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th className="num">Nodes</th>
              </tr>
            </thead>
            <tbody>
              {'items' in result && result.found
                ? result.items.map((item) => {
                  const href = item.kind === 'dir' ? graphDirHash(item.path) : item.kind === 'file' ? graphFileHash(item.path) : null;
                  const id = fileId(item.fileRow);
                  return (
                    <tr key={item.key} data-graph-item={item.key}>
                      <td className="mono">
                        {href ? <a href={href}>{item.label}</a> : item.label}
                        {id && (
                          <>
                            {' '}
                            <a className="muted" href={nodeHash(id)}>node</a>
                          </>
                        )}
                      </td>
                      <td>{item.kind}</td>
                      <td className="num">{fmtNumber(item.nodes)}</td>
                    </tr>
                  );
                })
                : model.nodes.map((node) => (node.tone === 'more' ? (
                  <tr key={node.key} data-graph-item={node.key}>
                    <td className="mono">{node.label}</td>
                    <td>more</td>
                    <td className="num">{fmtNumber(node.size)}</td>
                  </tr>
                ) : (
                  <tr key={node.key} data-graph-item={node.key}>
                    <td className="mono">
                      <a href={nodeHash(node.key)}>{node.label}</a>
                    </td>
                    <td>{node.tooltip[1]}</td>
                    <td className="num">1</td>
                  </tr>
                )))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
