// #/node/<id>: resolves the id against the decoded nodes table. The full
// detail panel (edges, evidence, excerpts) comes in a later slice; this view
// shows the node's own fact fields, or says plainly that the id is unknown.
import { cellText, isTable, type ViewData } from '../data';
import { fmtNumber, text } from '../format';
import { sectionHash } from '../routes';

export function findNodeRow(data: ViewData, id: string): number {
  const nodes = data.segments.nodes;
  if (!isTable(nodes) || !nodes.columns.id) return -1;
  const target = data.strings.indexOf(id);
  if (target < 0) return -1;
  const ids = nodes.columns.id;
  for (let row = 0; row < nodes.rows; row += 1) if (ids[row] === target) return row;
  return -1;
}

export function NodeRoute({ data, id }: { data: ViewData; id: string }) {
  const row = findNodeRow(data, id);
  const nodes = data.segments.nodes;
  if (row < 0 || !isTable(nodes)) {
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
  const col = (name: string) => nodes.columns[name]?.[row] ?? -1;
  const str = (name: string) => cellText(data.strings, col(name));
  const line0 = col('line0');
  const line1 = col('line1');
  return (
    <div className="content" data-section="node" data-node-found="true">
      <section className="card">
        <h2 className="mono">{id}</h2>
        <dl className="facts">
          <dt>Type</dt>
          <dd>{text(str('type'))}</dd>
          <dt>Name</dt>
          <dd>{text(str('name'))}</dd>
          <dt>Path</dt>
          <dd className="mono">{text(str('path'))}</dd>
          <dt>Lines</dt>
          <dd>{line0 >= 0 ? `${fmtNumber(line0)}–${fmtNumber(line1)}` : '—'}</dd>
          <dt>Owner</dt>
          <dd className="mono">{text(str('owner'))}</dd>
        </dl>
        <p className="muted">Edges, evidence and source excerpts for this node are available in a later slice.</p>
      </section>
    </div>
  );
}
