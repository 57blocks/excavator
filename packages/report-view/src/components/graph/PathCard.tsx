import { formatNumber } from '../../lib/format';
import type { GraphIndex } from '../../data/indexes';
import type { GraphPath } from '../../lib/path-finding';
import { nodeColor } from '../../lib/node-colors';

const GLASS = 'glass rounded-card';

/**
 * The path between the two chosen nodes, step by step: each node selects it, and
 * between two nodes the type of the edge that joins them. When there is none it
 * says so. It states which way the path may follow an edge.
 */
export function PathCard({ index, from, to, directed, path, onSelect, onClear }: {
  index: Pick<GraphIndex, 'nodesById'>;
  from: string;
  to: string;
  directed: boolean;
  path: GraphPath | null;
  onSelect: (nodeId: string) => void;
  onClear: () => void;
}) {
  const nameOf = (id: string) => index.nodesById.get(id)?.name ?? id;
  const missing = !index.nodesById.has(from) || !index.nodesById.has(to);
  const way = directed ? 'Edges are followed only from source to target.' : 'Edges are followed in either direction.';
  return (
    <div className={`${GLASS} px-3 py-2.5`} data-xv-path-card={path ? 'found' : 'none'}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] text-ink"><span className="font-semibold">Path</span>{` ${nameOf(from)} to ${nameOf(to)}`}</span>
        <button type="button" onClick={onClear} className="shrink-0 cursor-pointer rounded-control border border-line-2 bg-surface px-2.5 py-0.5 text-xs text-ink hover:border-accent hover:text-accent">Clear path</button>
      </div>
      {path ? (
        <>
          <p className="mt-1 text-xs text-muted">{`${formatNumber(path.edges.length)} step${path.edges.length === 1 ? '' : 's'}. ${way}`}</p>
          <ol className="m-0 mt-1.5 flex max-h-56 list-none flex-col gap-0.5 overflow-auto p-0">
            {path.nodes.map((id, i) => {
              const node = index.nodesById.get(id);
              return (
                <li key={`${id}|${i}`} className="flex min-w-0 flex-col">
                  {i > 0 ? <span className="pl-4 text-[11px] text-muted">{`${path.edges[i - 1].type}${path.edges[i - 1].target === id ? '' : ' (against the edge direction)'}`}</span> : null}
                  <button type="button" data-xv-path-step={id} onClick={() => onSelect(id)} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-1.5 py-0.5 text-left text-ink hover:bg-highlight">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: nodeColor(node?.type ?? '') }} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{node?.name ?? id}</span>
                    <span className="shrink-0 text-[11px] text-muted">{node?.type ?? ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-ink">{missing ? 'One of the two nodes is not a node of the graph.' : 'No path between these two nodes.'}</p>
          <p className="mt-0.5 text-xs text-muted">{way}</p>
        </>
      )}
    </div>
  );
}
