import { useState } from 'react';

import { navigate, useRoute } from '../../hooks/use-route';
import { clearPathHash, setPathHash } from '../../lib/graph-actions';
import { parseGraphState } from '../../lib/graph-state';
import { useGraphUi } from '../../state/graph-ui';
import { useGraphScene } from '../../state/graph-scene';
import { Dialog } from './Dialog';
import { NodePicker } from './NodePicker';
import type { GraphScene } from '../../state/graph-scene';
import type { GraphState } from '../../lib/graph-state';

function PathForm({ scene, state, onDone }: { scene: GraphScene; state: GraphState; onDone: () => void }) {
  const [from, setFrom] = useState<string | null>(state.from ?? state.node);
  const [to, setTo] = useState<string | null>(state.to);
  const [directed, setDirected] = useState(state.directed);
  const ready = from !== null && to !== null;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (from === null || to === null) return;
        navigate(setPathHash(state, from, to, directed));
        onDone();
      }}
    >
      <p className="m-0 text-muted">Finds the shortest path between two nodes along the graph's edges, of every type, and highlights it in the graph.</p>
      <NodePicker label="From" scene={scene} value={from} onChange={setFrom} />
      <NodePicker label="To" scene={scene} value={to} onChange={setTo} />
      <label className="flex items-start gap-2 text-ink-soft">
        <input type="checkbox" checked={directed} onChange={(event) => setDirected(event.target.checked)} className="mt-1" />
        <span>
          Follow each edge only from its source to its target
          <span className="block text-xs text-muted">{directed ? 'The path follows edges in their direction.' : 'The path follows each edge in either direction.'}</span>
        </span>
      </label>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={!ready} className="cursor-pointer rounded-control border border-accent bg-accent px-4 py-1.5 text-white hover:bg-violet disabled:cursor-not-allowed disabled:opacity-50">Find path</button>
        {state.from !== null ? (
          <button
            type="button"
            onClick={() => {
              navigate(clearPathHash(state));
              onDone();
            }}
            className="cursor-pointer rounded-control border border-line-2 bg-surface px-4 py-1.5 text-ink hover:border-accent hover:text-accent"
          >
            Clear path
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** The path dialog: choose two nodes, and the graph highlights the shortest path between them. */
export function PathDialog() {
  const { overlay, setOverlay } = useGraphUi();
  const { route } = useRoute();
  const open = overlay === 'path';
  const scene = useGraphScene(open);
  const state = parseGraphState(route.page === 'graph' ? route.params : {});
  return (
    <Dialog open={open} title="Find a path" onClose={() => setOverlay(null)}>
      {scene.state === 'ready' && scene.value ? <PathForm scene={scene.value} state={state} onDone={() => setOverlay(null)} /> : <p className="m-0 text-muted">{scene.state === 'error' ? scene.error.message : 'Reading the graph.'}</p>}
    </Dialog>
  );
}
