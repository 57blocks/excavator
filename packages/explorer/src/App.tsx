import { useEffect, useState, useMemo, lazy, Suspense } from "react";
import { validateGraph } from "@understand-anything/core/schema";
import type { GraphIssue } from "@understand-anything/core/schema";
import { useDashboardStore } from "./store";
import GraphView from "./components/GraphView";
import DomainGraphView from "./components/DomainGraphView";
import KnowledgeGraphView from "./components/KnowledgeGraphView";
import SearchBar from "./components/SearchBar";
import NodeInfo from "./components/NodeInfo";
import LayerLegend from "./components/LayerLegend";
import DiffToggle from "./components/DiffToggle";
import FilterPanel from "./components/FilterPanel";
import ExportMenu from "./components/ExportMenu";
import PersonaSelector from "./components/PersonaSelector";
import ProjectOverview from "./components/ProjectOverview";
import FileExplorer from "./components/FileExplorer";
import WarningBanner from "./components/WarningBanner";
import StalenessBanner from "./components/StalenessBanner";
import MobileLayout from "./components/MobileLayout";
import { useIsMobile } from "./hooks/useIsMobile";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { KeyboardShortcut } from "./hooks/useKeyboardShortcuts";
import { ThemeProvider } from "./themes/index.ts";
import { ThemePicker } from "./components/ThemePicker.tsx";
import ProductSwitch from "./excavator/ProductSwitch";
import ProductViewOverlay from "./excavator/ProductViewOverlay";
import ProductRowSidebar from "./excavator/views/ProductRowSidebar";
import { escapeProductView } from "./excavator/escape";
import type { ThemeConfig } from "./themes/index.ts";
import { I18nProvider, useI18n } from "./contexts/I18nContext.tsx";
import {
  hasInlineFile,
  inlineFetch,
  INLINE_ACCESS_TOKEN,
  readInlineFile,
} from "./offline/inlineData";
import {
  requestFreshnessReport,
  shouldRequestFreshness,
  startFreshnessRefresh,
  type DashboardFreshnessReport,
} from "./freshness";

// Lazy-load heavy / optional components so they ship in separate chunks.
const CodeViewer = lazy(() => import("./components/CodeViewer"));
const LearnPanel = lazy(() => import("./components/LearnPanel"));
const PathFinderModal = lazy(() => import("./components/PathFinderModal"));
const KeyboardShortcutsHelp = lazy(
  () => import("./components/KeyboardShortcutsHelp"),
);

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
type SidebarTab = "info" | "files";

function App() {
  // The offline page has no token gate: the token is always accepted.
  return <Dashboard accessToken={INLINE_ACCESS_TOKEN} />;
}

function Dashboard({ accessToken }: { accessToken: string }) {
  const setGraph = useDashboardStore((s) => s.setGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setDiffOverlay = useDashboardStore((s) => s.setDiffOverlay);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [graphIssues, setGraphIssues] = useState<GraphIssue[]>([]);
  const [graphFreshness, setGraphFreshness] =
    useState<DashboardFreshnessReport | null>(null);
  const [metaTheme, setMetaTheme] = useState<ThemeConfig | null>(null);
  const [outputLanguage, setOutputLanguage] = useState<string | undefined>();

  useEffect(() => {
    readInlineFile("meta.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (meta?.theme) setMetaTheme(meta.theme);
      })
      .catch(() => {});
    readInlineFile("config.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((config) => {
        if (config?.outputLanguage) setOutputLanguage(config.outputLanguage);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    readInlineFile("knowledge-graph.json")
      .then(async (res) => {
        // Guard res.ok before parsing (matching the meta.json/config.json/
        // diff-overlay.json/domain-graph.json fetches in this file). Without
        // this, a serving/config failure returns a 404 JSON error body that
        // gets parsed and handed to validateGraph, which fails project-metadata
        // validation and surfaces the misleading "Invalid knowledge graph:
        // Missing or invalid project metadata" instead of the real cause
        // (graph file not found / GRAPH_DIR unset). See issues #288, #406.
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) detail = body.error;
          } catch {
            /* non-JSON error body; keep the status code */
          }
          throw new Error(detail);
        }
        return res.json();
      })
      .then((data: unknown) => {
        const result = validateGraph(data);
        if (result.success && result.data) {
          setGraph(result.data);
          setGraphIssues(result.issues);
          if ((data as Record<string, unknown>).kind === "knowledge") {
            useDashboardStore.getState().setViewMode("knowledge");
            useDashboardStore.getState().setIsKnowledgeGraph(true);
          }
          for (const issue of result.issues) {
            if (issue.level === "auto-corrected") {
              console.warn(`[graph] auto-corrected: ${issue.message}`);
            } else if (issue.level === "dropped") {
              console.error(`[graph] dropped: ${issue.message}`);
            }
          }
        } else if (result.fatal) {
          console.error("Knowledge graph validation failed:", result.fatal);
          setLoadError(`Invalid knowledge graph: ${result.fatal}`);
        } else {
          console.error("Knowledge graph validation failed: unknown error");
          setLoadError("Invalid knowledge graph: unknown validation error");
        }
      })
      .catch((err) => {
        console.error("Failed to load knowledge graph:", err);
        setLoadError(`Failed to load knowledge graph: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [setGraph]);

  useEffect(() => {
    if (
      !hasInlineFile("staleness.json") ||
      !shouldRequestFreshness(
        DEMO_MODE,
        import.meta.env.VITE_STALENESS_URL,
      )
    ) {
      setGraphFreshness(null);
      return;
    }

    return startFreshnessRefresh({
      target: window,
      load: (signal) =>
        requestFreshnessReport("staleness.json", signal, inlineFetch),
      onResult: setGraphFreshness,
    });
  }, [accessToken]);

  useEffect(() => {
    readInlineFile("diff-overlay.json")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (
          data &&
          typeof data === "object" &&
          "changedNodeIds" in data &&
          "affectedNodeIds" in data &&
          Array.isArray((data as Record<string, unknown>).changedNodeIds) &&
          Array.isArray((data as Record<string, unknown>).affectedNodeIds)
        ) {
          const d = data as {
            changedNodeIds: string[];
            affectedNodeIds: string[];
            label?: unknown;
            description?: unknown;
          };
          if (d.changedNodeIds.length > 0) {
            setDiffOverlay(
              d.changedNodeIds,
              d.affectedNodeIds,
              typeof d.label === "string" && d.label ? d.label : undefined,
              typeof d.description === "string" && d.description ? d.description : undefined,
            );
          }
        }
      })
      .catch(() => {});
  }, [setDiffOverlay]);

  useEffect(() => {
    readInlineFile("domain-graph.json")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (!data) return;
        const result = validateGraph(data);
        if (result.success && result.data) {
          setDomainGraph(result.data);
        } else if (result.fatal) {
          console.warn(`[domain-graph] validation failed: ${result.fatal}`);
        }
      })
      .catch(() => {});
  }, [setDomainGraph]);

  return (
    <I18nProvider language={outputLanguage ?? "en"}>
      <ThemeProvider metaTheme={metaTheme}>
        <DashboardContent
          accessToken={accessToken}
          loadError={loadError}
          graphIssues={graphIssues}
          graphFreshness={graphFreshness}
        />
      </ThemeProvider>
    </I18nProvider>
  );
}

function DashboardContent({
  accessToken,
  loadError,
  graphIssues,
  graphFreshness,
}: {
  accessToken: string;
  loadError: string | null;
  graphIssues: GraphIssue[];
  graphFreshness: DashboardFreshnessReport | null;
}) {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const persona = useDashboardStore((s) => s.persona);
  const productRowOpen = useDashboardStore((s) => s.productView !== null && s.productRow !== null);
  const codeViewerOpen = useDashboardStore((s) => s.codeViewerOpen);
  const codeViewerExpanded = useDashboardStore((s) => s.codeViewerExpanded);
  const expandCodeViewer = useDashboardStore((s) => s.expandCodeViewer);
  const collapseCodeViewer = useDashboardStore((s) => s.collapseCodeViewer);
  const pathFinderOpen = useDashboardStore((s) => s.pathFinderOpen);
  const togglePathFinder = useDashboardStore((s) => s.togglePathFinder);
  // Excavator: no Files | Classes switch and no node-type chips (openspec: changes/explorer-products,
  // design D2): detailLevel stays "file" and every type filter stays on; the store keeps the state.
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("info");
  // Excavator: no first-visit onboarding overlay (openspec: changes/explorer-products, design D5).
  const viewMode = useDashboardStore((s) => s.viewMode);
  // Excavator: a mode button is highlighted only while the graph, not a product view, is shown (openspec: changes/explorer-view-defaults, design D1).
  const shownMode = useDashboardStore((s) => (s.productView === null ? s.viewMode : null));
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const layoutIssues = useDashboardStore((s) => s.layoutIssues);
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const allIssues = useMemo(
    () => [...graphIssues, ...layoutIssues],
    [graphIssues, layoutIssues],
  );

  useEffect(() => {
    if (selectedNodeId) setSidebarTab("info");
  }, [selectedNodeId]);

  // Excavator: a chosen product row shows its details on the Info tab.
  useEffect(() => {
    if (productRowOpen) setSidebarTab("info");
  }, [productRowOpen]);

  // Define keyboard shortcuts
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      // Help
      {
        key: "?",
        shiftKey: true,
        description: t.keyboardShortcuts.showHelp,
        action: () => setShowKeyboardHelp((prev) => !prev),
        category: "General",
      },
      // Navigation
      {
        key: "Escape",
        description: t.keyboardShortcuts.escapeDesc,
        action: () => {
          // Read from store at invocation time to avoid stale closures
          const state = useDashboardStore.getState();
          if (state.pathFinderOpen) {
            state.togglePathFinder();
          } else if (state.filterPanelOpen) {
            state.toggleFilterPanel();
          } else if (state.exportMenuOpen) {
            state.toggleExportMenu();
          } else if (state.codeViewerExpanded) {
            state.collapseCodeViewer();
          } else if (state.codeViewerOpen) {
            state.closeCodeViewer();
          } else if (escapeProductView(state)) {
            // Excavator: the product view's chosen row is cleared first, then the view closes.
          } else if (state.selectedNodeId) {
            state.selectNode(null);
          } else if (state.navigationLevel === "layer-detail") {
            state.navigateToOverview();
          } else if (state.tourActive) {
            state.stopTour();
          } else {
            setShowKeyboardHelp(false);
          }
        },
        category: "Navigation",
      },
      {
        key: "/",
        description: t.keyboardShortcuts.focusSearch,
        action: () => {
          const searchInput = document.querySelector<HTMLInputElement>(
            '[data-testid="search-input"]'
          );
          searchInput?.focus();
        },
        category: "Navigation",
      },
      // Tour controls
      {
        key: "ArrowRight",
        description: t.keyboardShortcuts.nextStep,
        action: () => {
          const state = useDashboardStore.getState();
          if (state.tourActive) {
            state.nextTourStep();
          }
        },
        category: "Tour",
      },
      {
        key: "ArrowLeft",
        description: t.keyboardShortcuts.prevStep,
        action: () => {
          const state = useDashboardStore.getState();
          if (state.tourActive) {
            state.prevTourStep();
          }
        },
        category: "Tour",
      },
      // View toggles
      {
        key: "d",
        description: t.keyboardShortcuts.toggleDiff,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleDiffMode();
        },
        category: "View",
      },
      {
        key: "f",
        description: t.keyboardShortcuts.toggleFilter,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleFilterPanel();
        },
        category: "View",
      },
      {
        key: "e",
        description: t.keyboardShortcuts.toggleExport,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleExportMenu();
        },
        category: "View",
      },
      {
        key: "p",
        description: t.keyboardShortcuts.openPathFinder,
        action: () => {
          const state = useDashboardStore.getState();
          state.togglePathFinder();
        },
        category: "View",
      },
    ],
    [t]
  );

  // Register keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  // Determine sidebar content
  // NodeInfo always takes priority when a node is selected.
  // Learn mode adds LearnPanel below it; otherwise ProjectOverview shows when idle.
  const isLearnMode = tourActive || persona === "junior";
  const infoSidebarContent = productRowOpen ? (
    // Excavator: while a product view has a row chosen, the sidebar shows the row's details.
    <ProductRowSidebar />
  ) : (
    <>
      {selectedNodeId && <NodeInfo />}
      {isLearnMode && (
        <Suspense fallback={null}>
          <LearnPanel />
        </Suspense>
      )}
      {!selectedNodeId && !isLearnMode && <ProjectOverview />}
    </>
  );

  const sidebarContent = (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 p-2 border-b border-border-subtle bg-surface shrink-0">
        {(["info", "files"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSidebarTab(tab)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
              sidebarTab === tab
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:text-text-primary hover:bg-elevated"
            }`}
          >
            {tab === "info" ? t.sidebar.info : t.sidebar.files}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {sidebarTab === "files" ? <FileExplorer /> : infoSidebarContent}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <MobileLayout
        accessToken={accessToken}
        showKeyboardHelp={showKeyboardHelp}
        setShowKeyboardHelp={setShowKeyboardHelp}
        loadError={loadError}
        allIssues={allIssues}
        graphFreshness={graphFreshness}
        shortcuts={shortcuts}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-root text-text-primary noise-overlay">
      {/* Header */}
      {/* Excavator: below lg the header wraps (the middle cluster, with the product buttons, takes its own row) so it never scrolls the page sideways. */}
      <header className="flex flex-wrap lg:flex-nowrap items-center px-3 sm:px-5 py-3 bg-surface border-b border-border-subtle shrink-0 gap-x-2 gap-y-2 sm:gap-x-4">
        {/* Left — fixed */}
        <div className="flex items-center gap-3 sm:gap-5 shrink-0 min-w-0">
          <h1 className="font-heading text-base sm:text-lg text-text-primary tracking-wide truncate max-w-[160px] sm:max-w-[220px] lg:max-w-none">
            {graph?.project.name ?? t.common.appName}
          </h1>
          <div className="w-px h-5 bg-border-subtle hidden sm:block" />
          <PersonaSelector />
          {graph && !isKnowledgeGraph && domainGraph && (
            <>
              <div className="w-px h-5 bg-border-subtle" />
              <div className="flex items-center bg-elevated rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("domain")}
                  title={t.drawer.domain}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    shownMode === "domain"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {t.drawer.domain}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("structural")}
                  title={t.drawer.structural}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    shownMode === "structural"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {t.drawer.structural}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Middle — scrollable legends */}
        <div className="order-last w-full min-w-0 overflow-x-auto scrollbar-hide lg:order-none lg:w-auto lg:flex-1">
          <div className="flex items-center gap-4 w-max">
            <DiffToggle />
            {/* Excavator: the three product views, where the Files | Classes switch and the type chips were. */}
            {graph && (
              <>
                <div className="w-px h-5 bg-border-subtle" />
                <ProductSwitch />
              </>
            )}
            <LayerLegend />
          </div>
        </div>

        {/* Right — fixed actions */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <FilterPanel />
          <ExportMenu />
          <button
            onClick={togglePathFinder}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            title={t.pathFinder.title}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
            <span className="hidden md:inline">{t.common.path}</span>
          </button>
          <ThemePicker />
          <button
            onClick={() => setShowKeyboardHelp(true)}
            className="text-text-muted hover:text-accent transition-colors"
            title={t.keyboardShortcuts.showHelp}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Search */}
      <SearchBar />

      {/* Graph freshness warning banner */}
      {!loadError && <StalenessBanner freshness={graphFreshness} />}

      {/* Validation warning banner */}
      {allIssues.length > 0 && !loadError && (
        <WarningBanner issues={allIssues} />
      )}

      {/* Error banner */}
      {loadError && (
        <div className="px-5 py-3 bg-red-900/30 border-b border-red-700 text-red-200 text-sm">
          {loadError}
        </div>
      )}

      {/* Main content: Graph + Sidebar */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Graph area */}
        <div className="flex-1 min-w-0 min-h-0 relative">
          {viewMode === "knowledge" ? (
            <KnowledgeGraphView />
          ) : viewMode === "domain" && domainGraph ? (
            <DomainGraphView />
          ) : (
            <GraphView />
          )}
          <div className="absolute top-3 right-3 text-sm text-text-muted/60 pointer-events-none select-none">
            {t.common.pressKeyboard}
          </div>
          {/* Excavator: the product view covers the graph area only; the graph above stays mounted. */}
          <ProductViewOverlay />
        </div>

        {/* Right sidebar — telescopes at narrower widths */}
        <aside className="w-[260px] md:w-[300px] lg:w-[360px] shrink-0 bg-surface border-l border-border-subtle overflow-auto">
          {sidebarContent}
        </aside>

        {/* Code viewer slide-up overlay (collapsed state) */}
        {codeViewerOpen && !codeViewerExpanded && (
          <div className="absolute bottom-0 left-0 right-0 h-[40vh] bg-surface border-t border-border-subtle animate-slide-up z-20 overflow-hidden">
            <Suspense fallback={null}>
              <CodeViewer accessToken={accessToken} onExpand={expandCodeViewer} />
            </Suspense>
          </div>
        )}
      </div>

      {/* Expanded code viewer modal */}
      {codeViewerOpen && codeViewerExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 sm:p-6"
          onMouseDown={collapseCodeViewer}
        >
          <div
            className="w-[calc(100vw-32px)] max-w-[1120px] h-[calc(100vh-32px)] sm:h-[calc(100vh-48px)] max-h-[820px] rounded-lg border border-border-medium bg-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={null}>
              <CodeViewer
                accessToken={accessToken}
                presentation="modal"
                onClose={collapseCodeViewer}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts help modal */}
      {showKeyboardHelp && (
        <Suspense fallback={null}>
          <KeyboardShortcutsHelp
            shortcuts={shortcuts}
            onClose={() => setShowKeyboardHelp(false)}
          />
        </Suspense>
      )}

      {/* Path Finder Modal — only mounted when open so its chunk is lazy-loaded on demand. */}
      {pathFinderOpen && (
        <Suspense fallback={null}>
          <PathFinderModal isOpen={pathFinderOpen} onClose={togglePathFinder} />
        </Suspense>
      )}
    </div>
  );
}

export default App;
