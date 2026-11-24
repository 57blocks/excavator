import { create } from "zustand";
import { SearchEngine } from "@understand-anything/core/search";
import type { SearchResult } from "@understand-anything/core/search";
import type { GraphIssue } from "@understand-anything/core/schema";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { withDerivedGroups, type LayerSource } from "./excavator/groups";
import { parseNameTranslations, translatorOf, type NameTranslations } from "./excavator/nameTranslations";
import { goToTarget } from "./excavator/canvasSelection";
import { readFeatureGroups, type FeatureGroups } from "./excavator/domainLevels";
import type { CanvasNodeType } from "./excavator/canvasSelection";
import type { RelationsMode } from "./excavator/graphRelations";
import { sourceNodeId, type SourceTarget } from "./excavator/views/sourceNode";

/** One place the user has been: the level, the selection and where the canvas was. */
export interface HistoryEntry {
  viewMode: ViewMode;
  activeDomainId: string | null;
  activeGroupId: string | null;
  navigationLevel: NavigationLevel;
  activeLayerId: string | null;
  expandedContainers: Set<string>;
  selectedNodeId: string | null;
  selectedGroupId: string | null;
  viewport: ViewportState | null;
}
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}
export const MAX_HISTORY_ENTRIES = 100;

export type NavigationLevel = "overview" | "layer-detail";
export type ViewMode = "structural" | "domain" | "knowledge";

/**
 * Build the (id → node) and (id → layerId) lookup maps that the rest of
 * the dashboard reads via store selectors. Centralised so `setGraph` and
 * any future graph-replacement path stay in sync.
 *
 * Two layer indexes, intentionally distinct:
 *
 * - `nodeIdToLayerId` preserves the prior `findNodeLayer` "first matching
 *   layer wins" semantics — if a node id appears in multiple layers
 *   (rare but legal in the schema), the first occurrence in `graph.layers`
 *   order is the one we map to. Drives navigation (drillIntoLayer,
 *   sidebar history) where a single canonical layer is the
 *   right answer.
 *
 * - `nodeIdToLayerIds` records *every* layer a node belongs to. Drives
 *   membership queries (filterNodes) where the prior `Layer[] +
 *   layer.nodeIds.includes` shape was any-layer-wins — a node in L1 and
 *   L2 with only L2 selected must still pass. Collapsing to first-wins
 *   for filtering would be a silent regression.
 */
function buildGraphIndexes(graph: KnowledgeGraph): {
  nodesById: Map<string, GraphNode>;
  nodeIdToLayerId: Map<string, string>;
  nodeIdToLayerIds: Map<string, Set<string>>;
} {
  const nodesById = new Map<string, GraphNode>();
  for (const node of graph.nodes) nodesById.set(node.id, node);
  const nodeIdToLayerId = new Map<string, string>();
  const nodeIdToLayerIds = new Map<string, Set<string>>();
  for (const layer of graph.layers) {
    for (const nid of layer.nodeIds) {
      if (!nodeIdToLayerId.has(nid)) nodeIdToLayerId.set(nid, layer.id);
      let set = nodeIdToLayerIds.get(nid);
      if (!set) {
        set = new Set<string>();
        nodeIdToLayerIds.set(nid, set);
      }
      set.add(layer.id);
    }
  }
  return { nodesById, nodeIdToLayerId, nodeIdToLayerIds };
}

/** Maximum number of entries in the sidebar navigation history. */
const MAX_HISTORY = 50;

interface DashboardStore {
  graph: KnowledgeGraph | null;
  /** Where `graph.layers` came from: the graph, or groups derived because it had none (excavator/groups.ts). */
  layerSource: LayerSource;
  /** id → node lookup, rebuilt by setGraph. Empty before any graph loads. */
  nodesById: Map<string, GraphNode>;
  /** id → layer id (first-matching-layer wins), rebuilt by setGraph. Empty before any graph loads. */
  nodeIdToLayerId: Map<string, string>;
  /** id → set of every layer the node belongs to, rebuilt by setGraph. Empty before any graph loads. */
  nodeIdToLayerIds: Map<string, Set<string>>;
  selectedNodeId: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searchEngine: SearchEngine | null;
  /** Excavator: the page's name table when it was packed with `--language`; null shows the English names (openspec: changes/view-name-translation). */
  nameTranslations: NameTranslations | null;
  /** Reads the page's `name-translations.json` data; data that is not that shape leaves the English names. */
  setNameTranslations: (raw: unknown) => void;
  /** Whether the page shows the translated names (the language switch); the English names show when false. */
  showTranslations: boolean;
  setShowTranslations: (show: boolean) => void;

  // Lens navigation
  navigationLevel: NavigationLevel;
  activeLayerId: string | null;

  codeViewerOpen: boolean;
  codeViewerNodeId: string | null;
  /** Excavator: the file the viewer shows when it was opened by path (codeViewerNodeId is then its source node id). */
  codeViewerSource: SourceTarget | null;
  codeViewerExpanded: boolean;

  // Focus mode: isolate a node's 1-hop neighborhood
  focusNodeId: string | null;

  // Sidebar navigation history (stack of visited node IDs)
  nodeHistory: string[];

  setGraph: (graph: KnowledgeGraph) => void;
  selectNode: (nodeId: string | null) => void;
  navigateToNode: (nodeId: string) => void;
  navigateToNodeInLayer: (nodeId: string) => void;
  navigateToHistoryIndex: (index: number) => void;
  goBackNode: () => void;
  drillIntoLayer: (layerId: string) => void;
  navigateToOverview: () => void;
  setFocusNode: (nodeId: string | null) => void;
  setSearchQuery: (query: string) => void;
  openCodeViewer: (nodeId: string) => void;
  /** Excavator: opens the code viewer on a file by path, for a product row whose file has no graph node. */
  openCodeViewerAt: (path: string, range: [number, number] | null) => void;
  closeCodeViewer: () => void;
  expandCodeViewer: () => void;
  collapseCodeViewer: () => void;

  // View mode
  viewMode: ViewMode;
  isKnowledgeGraph: boolean;
  domainGraph: KnowledgeGraph | null;
  activeDomainId: string | null;

  setDomainGraph: (graph: KnowledgeGraph) => void;
  setViewMode: (mode: ViewMode) => void;
  setIsKnowledgeGraph: (value: boolean) => void;
  navigateToDomain: (domainId: string) => void;
  clearActiveDomain: () => void;
  /** Excavator: the feature groups the packer wrote, or why the page has none; the Domain view's first level inside a domain. */
  featureGroups: FeatureGroups;
  setFeatureGroups: (raw: unknown) => void;
  /** Excavator: the open group of the open domain (null: the domain's group cards). */
  activeGroupId: string | null;
  openGroup: (groupId: string) => void;
  /** Excavator: one level up in the Domain view: group, then domain, then all domains. */
  goUp: () => void;
  /** Excavator: the group card selected on the group level (its flows show in the panel). Null when none. */
  selectedGroupId: string | null;
  selectGroup: (groupId: string | null) => void;
  /**
   * Excavator: the one "go to" that search results and every panel list share. The node is selected on the level that
   * holds it (opened first when it is not the current one) and the canvas pans to it, zoom unchanged.
   */
  goToNode: (nodeId: string) => void;
  /**
   * Excavator: Escape. Closes the code viewer, then clears the selection, and only when nothing is selected goes up
   * one level. `typing` is true while a text field has focus: it keeps its own Escape and nothing goes up.
   */
  pressEscape: (typing: boolean) => void;
  /** Excavator: the one history Back walks: every change of level pushes the state it leaves. Selection alone does not. */
  history: HistoryEntry[];
  /** Excavator: where the canvas is now (kept by onMoveEnd), so a push can record it. */
  viewport: ViewportState | null;
  setViewportState: (viewport: ViewportState) => void;
  /** Excavator: the viewport Back restored; the view that shows the level applies it instead of its own placement, then clears it. */
  pendingViewport: ViewportState | null;
  clearPendingViewport: () => void;
  goBack: () => void;
  /** Excavator: enters the next level of a canvas node (a double click, or the panel's Open button). */
  enterNode: (type: CanvasNodeType, id: string) => void;
  /** Excavator: a node the domain view is to scroll into view (centred, zoom unchanged). */
  domainRevealNodeId: string | null;
  clearDomainReveal: () => void;

  // Excavator: the right panel and the graph read the page data; no product view is laid over the graph.
  /** Excavator: a node chosen from outside the graph that the structural view is to open its container for and fit. */
  revealNodeId: string | null;
  clearRevealNode: () => void;
  /** Excavator: which relations of the relations product the structural graph draws (excavator/graphRelations.ts). */
  relationsMode: RelationsMode;
  setRelationsMode: (mode: RelationsMode) => void;

  // Container expand/collapse + lazy layout caches
  expandedContainers: Set<string>;
  toggleContainer: (containerId: string) => void;
  expandContainer: (containerId: string) => void;
  collapseContainer: (containerId: string) => void;
  collapseAllContainers: () => void;
  /** Container the user just manually expanded; viewport should lock onto it. Cleared by GraphView once the lock is applied. */
  pendingFocusContainer: string | null;
  setPendingFocusContainer: (containerId: string | null) => void;

  containerLayoutCache: Map<
    string,
    {
      childPositions: Map<string, { x: number; y: number }>;
      actualSize: { width: number; height: number };
    }
  >;
  setContainerLayout: (
    containerId: string,
    childPositions: Map<string, { x: number; y: number }>,
    actualSize: { width: number; height: number },
  ) => void;
  clearContainerLayouts: () => void;

  containerSizeMemory: Map<string, { width: number; height: number }>;

  stage1Tick: number;
  bumpStage1Tick: () => void;

  // Layout-time issues (e.g. ELK input repair). Funneled into the
  // status line alongside graph-validation issues.
  layoutIssues: GraphIssue[];
  appendLayoutIssues: (issues: GraphIssue[]) => void;
  clearLayoutIssues: () => void;
}

/**
 * Container ids derive from per-layer state — folder names in folder-strategy
 * layers, community indices (`container:cluster-N`) in community-strategy
 * layers — and collide across layers (e.g. API Contracts and Load Testing
 * both produce `container:cluster-0`). When navigation crosses layers we
 * must drop the previous layer's container caches so Stage 2 actually re-
 * runs for the new layer's children. Mirrors the reset block in
 * `drillIntoLayer`.
 */
function layerResetIfChanged(
  layerNav: Partial<DashboardStore>,
  prevLayerId: string | null,
): Partial<DashboardStore> {
  const next = layerNav.activeLayerId;
  if (!next || next === prevLayerId) return {};
  return {
    containerLayoutCache: new Map(),
    containerSizeMemory: new Map(),
    expandedContainers: new Set(),
    // Drop any pending focus too — its id was scoped to the previous
    // layer and would otherwise re-collide with a same-id container in
    // the new layer for the duration of the 1.2s timer.
    pendingFocusContainer: null,
  };
}

/** The name table the page shows names through: null (English) while the language switch is on English. */
/** The search engine over the domain graph's nodes, kept while the graph and the name table are the same objects. */
let domainEngineCache: { graph: KnowledgeGraph; table: NameTranslations | null; engine: SearchEngine } | null = null;

/** The engine a search runs on: the domain graph's nodes in the Domain view, the structural graph's otherwise. */
function engineFor(state: Pick<DashboardStore, "viewMode" | "domainGraph" | "nameTranslations" | "searchEngine">): SearchEngine | null {
  if (state.viewMode !== "domain" || !state.domainGraph) return state.searchEngine;
  const cached = domainEngineCache;
  if (cached && cached.graph === state.domainGraph && cached.table === state.nameTranslations) return cached.engine;
  const engine = new SearchEngine(state.domainGraph.nodes, translatorOf(state.nameTranslations));
  domainEngineCache = { graph: state.domainGraph, table: state.nameTranslations, engine };
  return engine;
}

export const activeTranslations = (s: Pick<DashboardStore, "showTranslations" | "nameTranslations">): NameTranslations | null =>
  s.showTranslations ? s.nameTranslations : null;

const levelKeyOf = (s: Pick<DashboardStore, "viewMode" | "activeDomainId" | "activeGroupId" | "navigationLevel" | "activeLayerId" | "expandedContainers">): string =>
  [s.viewMode, s.activeDomainId, s.activeGroupId, s.navigationLevel, s.activeLayerId, [...s.expandedContainers].sort().join(",")].join("|");

const snapshotOf = (s: DashboardStore): HistoryEntry => ({
  viewMode: s.viewMode,
  activeDomainId: s.activeDomainId,
  activeGroupId: s.activeGroupId,
  navigationLevel: s.navigationLevel,
  activeLayerId: s.activeLayerId,
  expandedContainers: new Set(s.expandedContainers),
  selectedNodeId: s.selectedNodeId,
  selectedGroupId: s.selectedGroupId,
  viewport: s.viewport,
});

/** Nested navigation actions (a go-to that drills in, Escape that goes up) record one entry, from the outermost call. */
let recording = 0;

/** Wraps a navigation action so that, when it changes the level, the state it left is pushed on the history. */
function recorded<A extends unknown[]>(
  get: () => DashboardStore,
  set: (partial: Partial<DashboardStore>) => void,
  run: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    if (recording > 0) {
      run(...args);
      return;
    }
    const before = snapshotOf(get());
    const key = levelKeyOf(get());
    recording += 1;
    try {
      run(...args);
    } finally {
      recording -= 1;
    }
    if (levelKeyOf(get()) !== key) set({ history: [...get().history, before].slice(-MAX_HISTORY_ENTRIES) });
  };
}

const RECORDED_ACTIONS = ["navigateToDomain", "clearActiveDomain", "openGroup", "goUp", "goToNode", "setViewMode", "drillIntoLayer", "navigateToOverview", "toggleContainer"] as const;

export const useDashboardStore = create<DashboardStore>()((set, get) => {
  const state: DashboardStore = ({
  graph: null,
  layerSource: "graph",
  nodesById: new Map<string, GraphNode>(),
  nodeIdToLayerId: new Map<string, string>(),
  nodeIdToLayerIds: new Map<string, Set<string>>(),
  selectedNodeId: null,
  searchQuery: "",
  searchResults: [],
  searchEngine: null,
  nameTranslations: null,
  showTranslations: true,
  setShowTranslations: (show) => set({ showTranslations: show }),

  navigationLevel: "overview",
  activeLayerId: null,
  codeViewerOpen: false,
  codeViewerNodeId: null,
  codeViewerSource: null,
  codeViewerExpanded: false,

  focusNodeId: null,
  nodeHistory: [],

  setGraph: (loaded) => {
    const { graph, layerSource } = withDerivedGroups(loaded);
    const searchEngine = new SearchEngine(graph.nodes, translatorOf(get().nameTranslations));
    const query = get().searchQuery;
    const searchResults = query.trim() ? searchEngine.search(query) : [];
    const { viewMode, domainGraph, activeDomainId } = get();
    // Preserve domain view if a domain graph is already loaded
    const keepDomainView = viewMode === "domain" && domainGraph !== null;
    const { nodesById, nodeIdToLayerId, nodeIdToLayerIds } = buildGraphIndexes(graph);
    set({
      graph,
      layerSource,
      nodesById,
      nodeIdToLayerId,
      nodeIdToLayerIds,
      searchEngine,
      searchResults,
      navigationLevel: "overview",
      activeLayerId: null,
      selectedNodeId: null,
      focusNodeId: null,
      nodeHistory: [],
      viewMode: keepDomainView ? "domain" as const : "structural" as const,
      activeDomainId: keepDomainView ? activeDomainId : null,
      containerLayoutCache: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
      containerSizeMemory: new Map(),
      stage1Tick: 0,
      layoutIssues: [],
    });
  },

  selectNode: (nodeId) => {
    const { selectedNodeId, nodeHistory } = get();
    if (nodeId && selectedNodeId && nodeId !== selectedNodeId) {
      // Push current node to history before navigating away
      set({
        selectedNodeId: nodeId,
        selectedGroupId: null,
        nodeHistory: [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY),
        // Excavator: a node chosen in the graph ends the reveal of one chosen from outside it.
        revealNodeId: null,
      });
    } else {
      set({ selectedNodeId: nodeId, selectedGroupId: null, revealNodeId: null });
    }
  },

  navigateToNode: (nodeId) => {
    get().navigateToNodeInLayer(nodeId);
  },

  navigateToNodeInLayer: (nodeId) => {
    const { graph, selectedNodeId, nodeHistory, nodeIdToLayerId, activeLayerId } = get();
    if (!graph) return;
    const layerId = nodeIdToLayerId.get(nodeId) ?? null;
    const newHistory =
      selectedNodeId && nodeId !== selectedNodeId
        ? [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY)
        : nodeHistory;
    if (layerId) {
      const layerNav = {
        navigationLevel: "layer-detail" as const,
        activeLayerId: layerId,
      };
      set({
        ...layerNav,
        // Excavator: a node chosen from outside a product view (search, the file list, Show in graph) shows the graph.
        revealNodeId: nodeId,
        selectedNodeId: nodeId,
        focusNodeId: null,
        codeViewerOpen: false,
        codeViewerNodeId: null,
        codeViewerExpanded: false,
        nodeHistory: newHistory,
        ...layerResetIfChanged(layerNav, activeLayerId),
      });
    } else {
      set({
        selectedNodeId: nodeId,
        nodeHistory: newHistory,
      });
    }
  },

  navigateToHistoryIndex: (index) => {
    const { nodeHistory, graph, nodeIdToLayerId, activeLayerId } = get();
    if (!graph || index < 0 || index >= nodeHistory.length) return;
    const targetId = nodeHistory[index];
    const newHistory = nodeHistory.slice(0, index);
    const layerId = nodeIdToLayerId.get(targetId) ?? null;
    const layerNav = layerId
      ? { navigationLevel: "layer-detail" as const, activeLayerId: layerId }
      : {};
    set({
      selectedNodeId: targetId,
      nodeHistory: newHistory,
      ...layerNav,
      ...layerResetIfChanged(layerNav, activeLayerId),
    });
  },

  goBackNode: () => {
    const { nodeHistory, graph, nodeIdToLayerId, activeLayerId } = get();
    if (nodeHistory.length === 0 || !graph) return;
    const prevNodeId = nodeHistory[nodeHistory.length - 1];
    const newHistory = nodeHistory.slice(0, -1);
    const layerId = nodeIdToLayerId.get(prevNodeId) ?? null;
    if (layerId) {
      const layerNav = {
        navigationLevel: "layer-detail" as const,
        activeLayerId: layerId,
      };
      set({
        ...layerNav,
        selectedNodeId: prevNodeId,
        nodeHistory: newHistory,
        ...layerResetIfChanged(layerNav, activeLayerId),
      });
    } else {
      set({
        selectedNodeId: prevNodeId,
        nodeHistory: newHistory,
      });
    }
  },

  drillIntoLayer: (layerId) =>
    set({
      navigationLevel: "layer-detail",
      activeLayerId: layerId,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
      // Container ids derive from folder names and collide across layers
      // (e.g. `container:auth` exists in many layers). Drop the cache so
      // we don't render stale positions for the new layer's children.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  navigateToOverview: () =>
    set({
      navigationLevel: "overview",
      activeLayerId: null,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  setNameTranslations: (raw) => {
    const nameTranslations = parseNameTranslations(raw);
    const { graph, searchQuery } = get();
    if (!graph) {
      set({ nameTranslations });
      return;
    }
    // The search index holds the translated names, so a table that arrives after the graph rebuilds it and the query's results.
    const searchEngine = new SearchEngine(graph.nodes, translatorOf(nameTranslations));
    const next = { ...get(), nameTranslations, searchEngine };
    set({ nameTranslations, searchEngine, searchResults: searchQuery.trim() ? (engineFor(next)?.search(searchQuery) ?? []) : [] });
  },

  setFocusNode: (nodeId) =>
    set({
      focusNodeId: nodeId,
      selectedNodeId: nodeId,
      // Focus mode narrows filteredGraphNodes to focus + 1-hop; the
      // surviving containers have a subset of their original children,
      // and the cache must not return positions for filtered-out ids.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),
  setSearchQuery: (query) => {
    const engine = engineFor(get());
    if (!engine || !query.trim()) {
      set({ searchQuery: query, searchResults: [] });
      return;
    }
    const searchResults = engine.search(query);
    set({ searchQuery: query, searchResults });
  },

  openCodeViewer: (nodeId) =>
    set({ codeViewerOpen: true, codeViewerNodeId: nodeId, codeViewerExpanded: false }),
  openCodeViewerAt: (path, range) =>
    set({
      codeViewerOpen: true,
      codeViewerNodeId: sourceNodeId(path),
      codeViewerSource: { path, range },
      codeViewerExpanded: false,
    }),
  closeCodeViewer: () =>
    set({ codeViewerOpen: false, codeViewerNodeId: null, codeViewerSource: null, codeViewerExpanded: false }),
  expandCodeViewer: () => set({ codeViewerExpanded: true }),
  collapseCodeViewer: () => set({ codeViewerExpanded: false }),

  viewMode: "structural",
  isKnowledgeGraph: false,
  domainGraph: null,
  activeDomainId: null,
  featureGroups: readFeatureGroups(undefined),
  setFeatureGroups: (raw) => set({ featureGroups: readFeatureGroups(raw) }),
  activeGroupId: null,
  selectedGroupId: null,
  selectGroup: (groupId) => set({ selectedGroupId: groupId, selectedNodeId: null, focusNodeId: null }),
  goToNode: (nodeId) => {
    const state = get();
    const { viewMode, domainGraph, featureGroups } = state;
    if (viewMode === "domain" && domainGraph) {
      const target = goToTarget({ domainGraph, featureGroups }, nodeId);
      if (target === null) return;
      set({
        activeDomainId: target.activeDomainId,
        activeGroupId: target.activeGroupId,
        selectedNodeId: nodeId,
        selectedGroupId: null,
        focusNodeId: null,
        domainRevealNodeId: nodeId,
      });
      return;
    }
    // Structural: a layer lives on the overview; any other node opens its layer, as a search result always did.
    if (state.graph?.layers.some((layer) => layer.id === nodeId)) {
      if (state.navigationLevel !== "overview") state.navigateToOverview();
      get().selectNode(nodeId);
      return;
    }
    state.navigateToNodeInLayer(nodeId);
  },
  pressEscape: (typing) => {
    const state = get();
    if (state.codeViewerExpanded) state.collapseCodeViewer();
    else if (state.codeViewerOpen) state.closeCodeViewer();
    else if (state.selectedNodeId || state.selectedGroupId) state.selectNode(null);
    else if (state.viewMode === "domain" && state.activeDomainId !== null) {
      if (!typing) state.goUp();
    } else if (state.navigationLevel === "layer-detail") state.navigateToOverview();
  },
  enterNode: (type, id) => {
    if (type === "domain") get().navigateToDomain(id);
    else if (type === "group") get().openGroup(id);
    else if (type === "layer") get().drillIntoLayer(id);
    else if (type === "container") get().toggleContainer(id);
  },
  openGroup: (groupId) => set({ activeGroupId: groupId, selectedNodeId: null, selectedGroupId: null, focusNodeId: null }),
  goUp: () => {
    const { activeGroupId, activeDomainId } = get();
    if (activeGroupId !== null) set({ activeGroupId: null, selectedNodeId: null, selectedGroupId: null, focusNodeId: null });
    else if (activeDomainId !== null) get().clearActiveDomain();
  },
  domainRevealNodeId: null,
  clearDomainReveal: () => set({ domainRevealNodeId: null }),
  setDomainGraph: (graph) => {
    // Excavator: the first domain graph to arrive opens the Domain mode (openspec: changes/explorer-view-defaults, design D3).
    const { domainGraph, viewMode } = get();
    const openDomain = graph !== null && domainGraph === null && viewMode === "structural";
    set(openDomain ? { domainGraph: graph, viewMode: "domain" as const } : { domainGraph: graph });
  },

  setIsKnowledgeGraph: (value) => {
    set({ isKnowledgeGraph: value });
  },

  revealNodeId: null,
  clearRevealNode: () => set({ revealNodeId: null }),
  relationsMode: "selected",
  setRelationsMode: (mode) => set({ relationsMode: mode }),

  setViewMode: (mode) => {
    const query = get().searchQuery;
    const engine = engineFor({ ...get(), viewMode: mode });
    set({
      searchResults: engine && query.trim() ? engine.search(query) : [],
      viewMode: mode,
      selectedNodeId: null,
      selectedGroupId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
    });
  },

  navigateToDomain: (domainId) => {
    const { selectedNodeId, nodeHistory } = get();
    const newHistory = selectedNodeId
      ? [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY)
      : nodeHistory;
    set({
      viewMode: "domain" as const,
      activeDomainId: domainId,
      activeGroupId: null,
      // A drill-in leaves nothing selected on the next level.
      selectedNodeId: null,
      selectedGroupId: null,
      focusNodeId: null,
      nodeHistory: newHistory,
    });
  },

  clearActiveDomain: () => {
    set({
      activeDomainId: null,
      activeGroupId: null,
      selectedNodeId: null,
      selectedGroupId: null,
      focusNodeId: null,
    });
  },

  expandedContainers: new Set<string>(),
  pendingFocusContainer: null,
  setPendingFocusContainer: (containerId) =>
    set({ pendingFocusContainer: containerId }),
  toggleContainer: (containerId) =>
    set((state) => {
      const next = new Set(state.expandedContainers);
      const willExpand = !next.has(containerId);
      if (willExpand) next.add(containerId);
      else next.delete(containerId);
      return {
        expandedContainers: next,
        pendingFocusContainer: willExpand
          ? containerId
          : state.pendingFocusContainer,
      };
    }),
  expandContainer: (containerId) =>
    set((state) => {
      if (state.expandedContainers.has(containerId)) return {};
      const next = new Set(state.expandedContainers);
      next.add(containerId);
      return { expandedContainers: next };
    }),
  collapseContainer: (containerId) =>
    set((state) => {
      if (!state.expandedContainers.has(containerId)) return {};
      const next = new Set(state.expandedContainers);
      next.delete(containerId);
      return { expandedContainers: next };
    }),
  collapseAllContainers: () => set({ expandedContainers: new Set() }),

  containerLayoutCache: new Map(),
  setContainerLayout: (containerId, childPositions, actualSize) =>
    set((state) => {
      const next = new Map(state.containerLayoutCache);
      next.set(containerId, { childPositions, actualSize });
      const sizeNext = new Map(state.containerSizeMemory);
      sizeNext.set(containerId, actualSize);
      return { containerLayoutCache: next, containerSizeMemory: sizeNext };
    }),
  clearContainerLayouts: () =>
    set({ containerLayoutCache: new Map(), expandedContainers: new Set(), pendingFocusContainer: null }),

  containerSizeMemory: new Map(),

  stage1Tick: 0,
  bumpStage1Tick: () => set((s) => ({ stage1Tick: s.stage1Tick + 1 })),

  layoutIssues: [],
  appendLayoutIssues: (issues) =>
    set((state) => {
      if (issues.length === 0) return {};
      // Dedupe by level+message so a re-running effect doesn't repeatedly
      // pile up identical issues.
      const seen = new Set(
        state.layoutIssues.map((i) => `${i.level}|${i.message}`),
      );
      const fresh = issues.filter((i) => !seen.has(`${i.level}|${i.message}`));
      if (fresh.length === 0) return {};
      return { layoutIssues: [...state.layoutIssues, ...fresh] };
    }),
  clearLayoutIssues: () => set({ layoutIssues: [] }),

  history: [],
  viewport: null,
  setViewportState: (viewport) => set({ viewport }),
  pendingViewport: null,
  clearPendingViewport: () => set({ pendingViewport: null }),
  goBack: () => {
    const { history } = get();
    const entry = history[history.length - 1];
    if (entry === undefined) return;
    const query = get().searchQuery;
    const engine = engineFor({ ...get(), viewMode: entry.viewMode });
    set({
      history: history.slice(0, -1),
      viewMode: entry.viewMode,
      activeDomainId: entry.activeDomainId,
      activeGroupId: entry.activeGroupId,
      navigationLevel: entry.navigationLevel,
      activeLayerId: entry.activeLayerId,
      expandedContainers: new Set(entry.expandedContainers),
      selectedNodeId: entry.selectedNodeId,
      selectedGroupId: entry.selectedGroupId,
      focusNodeId: null,
      domainRevealNodeId: null,
      revealNodeId: null,
      pendingViewport: entry.viewport,
      searchResults: engine && query.trim() ? engine.search(query) : [],
      // Container ids derive from folder names and collide across layers: drop what the layer left behind.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      pendingFocusContainer: null,
    });
  },
  });
  const actions = state as unknown as Record<string, (...args: unknown[]) => void>;
  for (const name of RECORDED_ACTIONS) actions[name] = recorded(get, set, actions[name]);
  return state;
});

