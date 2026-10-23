import { fileNodeId } from '../data/indexes';
import { nodeLayerName } from '../lib/node-details';
import { NOT_IN_GRAPH } from '../lib/locate';
import { statusLabel } from '../lib/products';
import { loadGraphScene } from '../state/graph-scene';
import { useLoaded, useProduct, useViewer } from '../state/viewer';
import { ProductFacts } from './sidebar/ProductFacts';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { Facts } from './ui/Controls';
import { LocateButton } from './ui/LocateButton';

/**
 * Above the file the Code page shows (openspec: changes/viewer-learn, design D6): the file's node in the graph, the
 * products' facts about it (the cards of the graph's sidebar), and the move to the graph. A file the graph has no
 * node for, or a page without the graph, is said so.
 */
export function FileInGraph({ path }: { path: string }) {
  const { manifest, payloads } = useViewer();
  const graph = useProduct('knowledge-graph');
  const usable = graph.status === 'included' || graph.status === 'different-revision';
  const loaded = useLoaded(usable ? 'graph-scene' : 'no-graph', () => (usable ? loadGraphScene(manifest, payloads) : Promise.resolve(null)));
  let body: React.ReactNode;
  if (!usable) body = <p className="m-0 text-muted">{`${graph.label}: ${statusLabel(graph.status)}. The page has no graph to place this file in.`}</p>;
  else if (loaded.state === 'loading') body = <p className="m-0 text-muted">Reading the graph.</p>;
  else if (loaded.state === 'error') body = <p className="m-0 text-muted">{`The graph could not be read: ${loaded.error.message}`}</p>;
  else {
    const scene = loaded.value;
    const node = scene === null ? undefined : scene.model.index.nodesById.get(fileNodeId(path));
    if (scene === null || node === undefined) body = <p className="m-0 text-muted" data-xv-file-node="">{NOT_IN_GRAPH}</p>;
    else {
      const layer = nodeLayerName(scene.model.index, scene.structure, node.id);
      body = (
        <div className="flex flex-col gap-3" data-xv-file-node={node.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{node.type}</Badge>
            <span className="font-heading text-[15px] text-ink [overflow-wrap:anywhere]">{node.name}</span>
            <LocateButton target={{ kind: 'file', path }} overlay={null} />
          </div>
          {layer === null ? null : <Facts items={[['Layer', layer]]} />}
          <ProductFacts node={node} />
        </div>
      );
    }
  }
  return <Card title="In the graph">{body}</Card>;
}
