import { evidenceLocation } from '../lib/filter';
import { featureHash } from '../lib/route';
import type { PageData } from '../lib/types';
import { Markdown } from './Markdown';

/** `#/coverage`: the two tables the script wrote, the unassigned entrypoints, the frameworks without patterns and the failed features. */
export function CoveragePage({ data }: { data: PageData }) {
  const failed = data.features.filter((feature) => feature.status === 'failed');
  return (
    <div className="page wide" data-view="coverage">
      <h1>Coverage</h1>
      <p className="lede">What the run covered, from the tables the script wrote.</p>

      <Markdown source={data.tables.coverage} idPrefix="coverage" />
      <Markdown source={data.tables.verification} idPrefix="verification-table" />

      <h2 className="section">Entrypoints not assigned to a feature ({data.unassigned.length})</h2>
      {data.unassigned.length === 0 ? <div className="empty">Every entrypoint belongs to a feature.</div> : (
        <div className="table-scroll"><table data-table="unassigned">
          <thead><tr><th>Entrypoint</th><th>Location</th><th>Kind</th><th>Framework</th></tr></thead>
          <tbody>{data.unassigned.map((entry) => (
            <tr key={entry.id}><td>{entry.id}</td><td><span className="loc">{evidenceLocation(entry)}</span></td><td>{entry.kind}</td><td>{entry.framework}</td></tr>
          ))}</tbody>
        </table></div>
      )}

      <h2 className="section">Frameworks without entrypoint patterns ({data.uncovered.length})</h2>
      {data.uncovered.length === 0 ? <div className="empty">Every detected framework has entrypoint patterns.</div> : (
        <div className="chips" data-list="uncovered">{data.uncovered.map((name) => <span className="chip" key={name}>{name}</span>)}</div>
      )}

      <h2 className="section">Failed features ({failed.length})</h2>
      {failed.length === 0 ? <div className="empty">No feature failed.</div> : (
        <div className="table-scroll"><table data-table="failed">
          <thead><tr><th>Feature</th><th>Step</th><th>Reasons</th></tr></thead>
          <tbody>{failed.map((feature) => (
            <tr key={feature.id}>
              <td><a href={featureHash(feature.id)}><span className="nav-id">{feature.id}</span>{feature.name}</a></td>
              <td>{feature.failure?.step ?? '-'}</td>
              <td><ul style={{ margin: 0, paddingLeft: 18 }}>{(feature.failure?.reasons ?? []).map((reason, at) => <li key={at}>{reason}</li>)}</ul></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
