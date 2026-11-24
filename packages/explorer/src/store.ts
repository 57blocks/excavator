import { create } from "zustand";
import { SearchEngine } from "@understand-anything/core/search";
import type { SearchResult } from "@understand-anything/core/search";
import type { GraphIssue } from "@understand-anything/core/schema";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { withDerivedGroups, type LayerSource } from "./excavator/groups";
import { parseNameTranslations, translatorOf, type NameTranslations } from "./excavator/nameTranslations";
import type { RelationsMode } from "./excavator/graphRelations";
import { sourceNodeId, type SourceTarget } from "./excavator/views/sourceNode";

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
export const activeTranslations = (s: Pick<DashboardStore, "showTranslations" | "nameTranslations">): NameTranslations | null =>
  s.showTranslations ? s.nameTranslations : null;

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
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
        nodeHistory: [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY),
        // Excavator: a node chosen in the graph ends the reveal of one chosen from outside it.
        revealNodeId: null,
      });
    } else {
      set({ selectedNodeId: nodeId, revealNodeId: null });
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
    set({ nameTranslations, searchEngine, searchResults: searchQuery.trim() ? searchEngine.search(searchQuery) : [] });
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
    const engine = get().searchEngine;
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
    set({
      viewMode: mode,
      selectedNodeId: null,
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
      focusNodeId: null,
      nodeHistory: newHistory,
    });
  },

  clearActiveDomain: () => {
    set({
      activeDomainId: null,
      selectedNodeId: null,
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
}));

