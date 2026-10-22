import { useState } from 'react';

import { navigate } from '../../hooks/use-route';
import { locate as locateTarget, NOT_IN_GRAPH, type LocateTarget } from '../../lib/locate';
import type { OverlayName } from '../../lib/overlay-names';
import { loadGraphScene } from '../../state/graph-scene';
import { useProduct, useViewer } from '../../state/viewer';

const targetKey = (target: LocateTarget) => `${target.kind}:${target.kind === 'node' ? target.nodeId : target.path}`;

/**
 * "Locate in graph" for a row of a table: switches to the graph, drills to the node's level, selects it and turns on
 * the overlay of the row's product. When the graph has no such node it says so beside the button and does nothing
 * else. The graph is read on the first click, not when the table is shown.
 */
export function LocateButton({ target, overlay }: { target: LocateTarget; overlay: OverlayName | null }) {
  const { manifest, payloads } = useViewer();
  const graph = useProduct('knowledge-graph');
  const usable = graph.status === 'included' || graph.status === 'different-revision';
  // A row keeps no answer that was given for another target: the table reuses its rows when it is sorted or paged.
  const key = targetKey(target);
  const [answer, setAnswer] = useState<{ key: string; text: string } | null>(null);
  const message = answer !== null && answer.key === key ? answer.text : null;

  const locate = () => {
    loadGraphScene(manifest, payloads).then(
      (scene) => {
        const found = scene === null ? { message: NOT_IN_GRAPH } : locateTarget({ index: scene.model.index, structure: scene.structure }, target, overlay);
        if ('hash' in found) navigate(found.hash);
        else setAnswer({ key, text: found.message });
      },
      (error: unknown) => setAnswer({ key, text: error instanceof Error ? error.message : String(error) }),
    );
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        data-xv-locate={key}
        disabled={!usable}
        title={usable ? 'Show this in the graph' : `${graph.label}: ${graph.status === 'not-run' ? 'not run' : 'unreadable'}`}
        onClick={locate}
        className="cursor-pointer whitespace-nowrap rounded-control border border-line-2 bg-surface px-2 py-px text-xs text-ink hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-60"
      >
        Locate in graph
      </button>
      {message === null ? null : <span role="status" data-xv-locate-message="" className="text-xs text-muted">{message}</span>}
    </span>
  );
}
