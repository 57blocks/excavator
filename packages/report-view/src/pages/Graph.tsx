import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo } from 'react';

import { CodeDrawer } from '../components/CodeDrawer';
import { FocusView } from '../components/graph/FocusView';
import { LevelView, type LevelActions } from '../components/graph/LevelView';
import { LoadError } from '../components/ProductPage';
import { Panel } from '../components/shell/Panel';
import { NodeDetails } from '../components/sidebar/NodeDetails';
import { Card } from '../components/ui/Card';
import { Page } from '../components/ui/Page';
import { unavailableCard } from '../components/ui/ProductCards';
import { navigate, useRoute } from '../hooks/use-route';
import { useReady } from '../hooks/use-signals';
import { clearPathHash, clearSelectionHash, entryHash, levelHash, parentLevel, selectHash, setFocusHash } from '../lib/graph-actions';
import { escapeStep, graphHash, parseGraphState, type GraphState } from '../lib/graph-state';
import { buildLevel, type Crumb, type LevelEntry } from '../lib/graph-structure';
import { loadGraphScene, type GraphScene } from '../state/graph-scene';
import { useGraphUi } from '../state/graph-ui';
import { useLoaded, useProduct, useViewer } from '../state/viewer';

function NoLevel() {
  useReady('ready');
  return (
    <div className="p-6">
      <Card title="No such level in this graph">
        <p>The address names a directory, layer or fold that the graph does not have.</p>
        <p><a href={graphHash()}>Go to the top level</a></p>
      </Card>
    </div>
  );
}

/** The graph at the place the address names: a level, or the focus on one node, with the sidebar and the code drawer beside it. */
function GraphWorkspace({ scene }: { scene: GraphScene }) {
  const { route } = useRoute();
  const state: GraphState = useMemo(() => parseGraphState(route.params), [route]);
  const ui = useGraphUi();
  const { index } = scene.model;
  const level = useMemo(() => buildLevel(scene.structure, { path: state.path, fold: state.fold }), [scene, state.path, state.fold]);
  const node = state.node !== null ? (index.nodesById.get(state.node) ?? null) : null;

  const select = useCallback((nodeId: string) => navigate(graphHash({ ...state, node: nodeId, entry: null })), [state]);
  const selectElsewhere = useCallback((nodeId: string) => navigate(selectHash(state, index, scene.structure, nodeId)), [state, index, scene]);
  const clearSelection = useCallback(() => navigate(clearSelectionHash(state)), [state]);
  const actions: LevelActions = useMemo(() => ({
    open: (entry: LevelEntry) => entry.target && navigate(levelHash(state, entry.target.path, entry.target.fold)),
    details: (entry: LevelEntry) => navigate(state.entry === entry.id ? clearSelectionHash(state) : entryHash(state, entry.id)),
    select,
    clearSelection: () => (state.node !== null || state.entry !== null) && navigate(clearSelectionHash(state)),
    goCrumb: (crumb: Crumb) => navigate(levelHash(state, crumb.path, crumb.fold)),
    clearPath: () => navigate(clearPathHash(state)),
  }), [state, select]);

  // Esc closes the innermost thing: a dialog or menu, the drawer, the focus, the path, the selection, then a level.
  useEffect(() => {
    ui.escape.current = () => {
      const up = level ? parentLevel(level) : null;
      const step = escapeStep({
        overlay: ui.overlay !== null,
        drawer: ui.drawer !== 'closed' && node !== null,
        focus: state.focus,
        path: state.from !== null,
        selection: state.node !== null || state.entry !== null,
        canGoUp: up !== null,
      });
      if (step === 'overlay') {
        ui.setOverlay(null);
        (document.activeElement as HTMLElement | null)?.blur?.();
      } else if (step === 'drawer') ui.setDrawer('closed');
      else if (step === 'focus') navigate(setFocusHash(state, false));
      else if (step === 'path') navigate(clearPathHash(state));
      else if (step === 'selection') navigate(clearSelectionHash(state));
      else if (step === 'level' && up) navigate(levelHash(state, up.path, up.fold));
      return step !== 'none';
    };
    return () => {
      ui.escape.current = null;
    };
  });
  useEffect(() => () => ui.setDrawer('closed'), []);

  return (
    <>
      {state.focus && node ? (
        <FocusView scene={scene} centerId={node.id} filters={ui.filters} onSelect={select} onExit={() => navigate(setFocusHash(state, false))} />
      ) : level ? (
        <LevelView scene={scene} level={level} state={state} filters={ui.filters} actions={actions} />
      ) : (
        <NoLevel />
      )}
      <Panel slot="sidebar" open={state.node !== null} title={node?.name ?? state.node ?? ''} onClose={clearSelection} closeOnEscape={false}>
        {node ? (
          <NodeDetails
            scene={scene}
            node={node}
            focused={state.focus}
            onSelect={selectElsewhere}
            onOpenCode={() => ui.setDrawer('open')}
            onFocus={() => navigate(setFocusHash(state, !state.focus))}
            onStartPath={() => ui.setOverlay('path')}
          />
        ) : (
          <p className="m-0 text-muted">The graph has no node with this id.</p>
        )}
      </Panel>
      <CodeDrawer node={node} state={ui.drawer} onState={ui.setDrawer} onClose={() => ui.setDrawer('closed')} />
    </>
  );
}

/** The structure graph: the default view, drawn level by level. */
export function GraphPage() {
  const { manifest, payloads } = useViewer();
  const product = useProduct('knowledge-graph');
  const unavailable = unavailableCard(product);
  const loaded = useLoaded(unavailable ? '' : 'scene', () => (unavailable ? Promise.resolve(null) : loadGraphScene(manifest, payloads)));
  useReady(unavailable ? 'ready' : loaded.state === 'error' ? 'error' : 'loading');
  if (unavailable || loaded.state !== 'ready' || !loaded.value) {
    return (
      <div className="h-full overflow-auto p-6">
        <Page title="Graph" subtitle={manifest.project.name}>
          {unavailable}
          {!unavailable && loaded.state === 'error' ? <LoadError title="The knowledge graph could not be read" error={loaded.error} /> : null}
        </Page>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <GraphWorkspace scene={loaded.value} />
    </ReactFlowProvider>
  );
}
