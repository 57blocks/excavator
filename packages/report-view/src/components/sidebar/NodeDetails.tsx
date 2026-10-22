import { useMemo } from 'react';

import type { GraphNode } from '../../data/graph';
import { EMPTY } from '../../lib/format';
import { nodeColor } from '../../lib/node-colors';
import { nodeEdges } from '../../lib/node-edges';
import { nodeLanguage, nodeLayerName, nodeLines } from '../../lib/node-details';
import { nodeSummaryView } from '../../lib/node-summary';
import type { GraphScene } from '../../state/graph-scene';
import { NodeSummary } from '../NodeSummary';
import { Badge } from '../ui/Badge';
import { Facts } from '../ui/Controls';
import { EdgeGroups } from './EdgeGroups';
import { ProductFacts } from './ProductFacts';

const ACTION = 'cursor-pointer rounded-control border border-line-2 bg-surface px-3 py-1.5 text-[13px] text-ink hover:border-accent hover:text-accent';

/** The details of the selected node: its fields, summary, product facts, and its edges by type, each leading to the node at the other end. */
export function NodeDetails({ scene, node, focused, onSelect, onOpenCode, onFocus, onStartPath }: {
  scene: GraphScene;
  node: GraphNode;
  focused: boolean;
  onSelect: (nodeId: string) => void;
  onOpenCode: () => void;
  onFocus: () => void;
  onStartPath: () => void;
}) {
  const { index } = scene.model;
  const view = useMemo(() => nodeSummaryView(index, node.id), [index, node]);
  const edges = useMemo(() => nodeEdges(index, node.id), [index, node.id]);
  const lines = nodeLines(node);
  const layer = nodeLayerName(index, scene.structure, node.id);
  const language = nodeLanguage(node);
  return (
    <div className="flex flex-col gap-5 text-[13.5px]" data-xv-details={node.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: nodeColor(node.type) }} />
        <Badge tone="neutral">{node.type}</Badge>
      </div>
      <Facts
        items={[
          ['Name', node.name],
          ['Type', node.type],
          ['Language', language ?? EMPTY],
          ['Layer', layer ?? (scene.structure.mode === 'layers' ? 'In no layer' : 'The graph has no layers')],
          ['File', node.filePath ? <span className="font-mono text-xs" data-xv-detail="file">{node.filePath}</span> : EMPTY],
          ['Lines', lines ? <span className="font-mono text-xs" data-xv-detail="lines">{lines}</span> : EMPTY],
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {node.filePath ? <button type="button" data-xv-action="code" onClick={onOpenCode} className={ACTION}>Open code</button> : null}
        <button type="button" data-xv-action="focus" aria-pressed={focused} onClick={onFocus} className={ACTION}>{focused ? 'Exit focus' : 'Focus on this node'}</button>
        <button type="button" data-xv-action="path" onClick={onStartPath} className={ACTION}>Find a path from here</button>
      </div>
      {view ? <section aria-label="Summary"><h3 className="mb-1">Summary</h3><NodeSummary view={view} /></section> : null}
      <ProductFacts node={node} />
      <EdgeGroups title="Outgoing edges" total={edges.outTotal} groups={edges.out} onSelect={onSelect} />
      <EdgeGroups title="Incoming edges" total={edges.inTotal} groups={edges.in} onSelect={onSelect} />
    </div>
  );
}
