import { flowIndexRows } from '../lib/flow-index';
import type { Feature } from '../lib/types';

/** The flow index of the overview: built from the page data, each row linking to the page of its feature. */
export function FlowIndex({ features }: { features: Feature[] }) {
  const rows = flowIndexRows(features);
  if (rows.length === 0) return <div className="empty" data-flow-index="none">None.</div>;
  return (
    <div className="table-scroll">
      <table data-table="flow-index">
        <thead><tr><th>#</th><th>Flow</th><th>Feature</th><th>Kind</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.number} data-flow-row={row.number}>
              <td>{row.number}</td>
              <td><a href={row.href}>{row.flow}</a></td>
              <td>{row.feature}</td>
              <td>{row.kind}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
