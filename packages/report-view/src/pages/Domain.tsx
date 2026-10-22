import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { GraphNode } from '../data/graph';
import { CodeDrawer } from '../components/CodeDrawer';
import { DomainView } from '../components/graph/DomainView';
import { LoadError } from '../components/ProductPage';
import { Panel } from '../components/shell/Panel';
import { DomainDetails, type DomainDetailActions } from '../components/sidebar/DomainDetails';
import { Card } from '../components/ui/Card';
import { Page } from '../components/ui/Page';
import { unavailableCard } from '../components/ui/ProductCards';
import { navigate, useRoute } from '../hooks/use-route';
import { useReady } from '../hooks/use-signals';
import { DOMAIN_NOTE, revisionNote } from '../lib/domain-details';
import type { DomainEntry } from '../lib/domain-flow';
import { domainHash, drillDomainHash, drillFlowHash, parentPlaceHash, parseDomainState, resolvePlace, selectInPlaceHash, selectNodeHash } from '../lib/domain-state';
import { selectHash } from '../lib/graph-actions';
import { escapeStep, TOP_LEVEL } from '../lib/graph-state';
import { loadDomainScene, type DomainScene } from '../state/domain-scene';
import { useGraphUi } from '../state/graph-ui';
import { useLoaded, useProduct, useViewer } from '../state/viewer';

function NoPlace() {
  useReady('ready');
  return (
    <div className="p-6">
      <Card title="No such place in this domain graph">
        <p>The address names a domain or flow that the domain graph does not have, or a flow that is not in that domain.</p>
        <p><a href={domainHash()}>Go to the top level</a></p>
      </Card>
    </div>
  );
}

/** The fixed line at the top: what the domain graph is, and when it is not the one for this source and these facts, which revisions and digests differ. */
function Notice() {
  const { manifest } = useViewer();
  const product = useProduct('domain-graph');
  const difference = revisionNote(product, manifest.snapshot.revision);
  return (
    <div data-xv-domain-note="" className="shrink-0 border-b border-line-2 bg-surface px-4 py-2 text-xs leading-4 text-ink-soft">
      <p className="m-0">{DOMAIN_NOTE}</p>
      {difference ? <p data-xv-domain-revision="" className="m-0 mt-0.5 border-l-4 border-warning pl-2 text-ink">{difference}</p> : null}
    </div>
  );
}

/** The domain view at the place the address names, with the sidebar and the code drawer beside it. */
function DomainWorkspace({ scene }: { scene: DomainScene }) {
  const { route } = useRoute();
  const state = useMemo(() => parseDomainState(route.params), [route]);
  const place = useMemo(() => resolvePlace(scene.index, state), [scene, state]);
  const ui = useGraphUi();
  const node = state.node !== null ? (scene.index.nodesById.get(state.node) ?? null) : null;
  const here = place ?? ({ kind: 'top' } as const);
  const [drawerNode, setDrawerNode] = useState<GraphNode | null>(null);

  // The code drawer belongs to what was selected when it opened: another selection closes it.
  useEffect(() => {
    ui.setDrawer('closed');
    setDrawerNode(null);
  }, [state.node]);
  useEffect(() => () => ui.setDrawer('closed'), []);

  const open = useCallback((entry: DomainEntry) => {
    if (entry.openTo === null) return;
    navigate(entry.openTo.flow === null ? drillDomainHash(entry.openTo.domain) : drillFlowHash(entry.openTo.domain, entry.openTo.flow));
  }, []);
  const select = useCallback((id: string) => navigate(selectNodeHash(scene.index, here, id)), [scene, here]);
  const clearSelection = useCallback(() => state.node !== null && navigate(selectInPlaceHash(here, null)), [state.node, here]);
  const actions: DomainDetailActions = useMemo(() => ({
    onSelect: select,
    onOpen: (domain, flow) => navigate(flow === null ? drillDomainHash(domain) : drillFlowHash(domain, flow)),
    onGoToGraph: (nodeId) => navigate(selectHash(TOP_LEVEL, scene.graph.model.index, scene.graph.structure, nodeId)),
    onOpenCode: (target) => {
      setDrawerNode(target);
      ui.setDrawer('open');
    },
  }), [scene, select, ui]);

  // Esc closes the innermost thing: a dialog or menu, the drawer, the selection, then a place.
  useEffect(() => {
    ui.escape.current = () => {
      const up = place ? parentPlaceHash(place) : domainHash();
      const step = escapeStep({ overlay: ui.overlay !== null, drawer: ui.drawer !== 'closed' && drawerNode !== null, focus: false, path: false, selection: state.node !== null, canGoUp: up !== null });
      if (step === 'overlay') {
        ui.setOverlay(null);
        (document.activeElement as HTMLElement | null)?.blur?.();
      } else if (step === 'drawer') ui.setDrawer('closed');
      else if (step === 'selection') navigate(selectInPlaceHash(here, null));
      else if (step === 'level' && up) navigate(up);
      return step !== 'none';
    };
    return () => {
      ui.escape.current = null;
    };
  });

  return (
    <div className="flex size-full min-h-0 flex-col">
      <Notice />
      <div className="relative min-h-0 flex-1">
        {place ? (
          <DomainView scene={scene} place={place} selected={state.node} onOpen={open} onSelect={select} onClearSelection={clearSelection} onGo={(hash) => navigate(hash)} />
        ) : (
          <NoPlace />
        )}
      </div>
      <Panel slot="sidebar" open={state.node !== null} title={node?.name ?? state.node ?? ''} onClose={clearSelection} closeOnEscape={false}>
        {node ? <DomainDetails scene={scene} node={node} place={here} actions={actions} /> : <p className="m-0 text-muted">The domain graph has no node with this id.</p>}
      </Panel>
      <CodeDrawer node={drawerNode} state={ui.drawer} onState={ui.setDrawer} onClose={() => ui.setDrawer('closed')} />
    </div>
  );
}

/** The domain view: the domains of the project, the flows of each, and the steps of each flow. */
export function DomainPage() {
  const { manifest, payloads } = useViewer();
  const product = useProduct('domain-graph');
  const unavailable = unavailableCard(product);
  const loaded = useLoaded(unavailable ? '' : 'domain', () => (unavailable ? Promise.resolve(null) : loadDomainScene(manifest, payloads)));
  useReady(unavailable ? 'ready' : loaded.state === 'error' ? 'error' : 'loading');
  if (unavailable || loaded.state !== 'ready' || !loaded.value) {
    return (
      <div className="h-full overflow-auto p-6">
        <Page title="Domain" subtitle={manifest.project.name}>
          {unavailable}
          {!unavailable && loaded.state === 'error' ? <LoadError title="The domain graph could not be read" error={loaded.error} /> : null}
        </Page>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <DomainWorkspace scene={loaded.value} />
    </ReactFlowProvider>
  );
}
