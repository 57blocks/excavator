import { useEffect, useState, useMemo, lazy, Suspense } from "react";
import { validateGraph } from "@understand-anything/core/schema";
import type { GraphIssue } from "@understand-anything/core/schema";
import { useDashboardStore } from "./store";
import GraphView from "./components/GraphView";
import DomainGraphView from "./components/DomainGraphView";
import KnowledgeGraphView from "./components/KnowledgeGraphView";
import SearchBar from "./components/SearchBar";
import { SidePanel } from "./excavator/panel/SidePanel";
import MobileLayout from "./components/MobileLayout";
import { useIsMobile } from "./hooks/useIsMobile";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { KeyboardShortcut } from "./hooks/useKeyboardShortcuts";
import { ThemeProvider } from "./themes/index.ts";
import { ViewSwitch } from "./excavator/header/ViewSwitch";
import { LanguageSwitch } from "./excavator/header/LanguageSwitch";
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

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

function App() {
  // The offline page has no token gate: the token is always accepted.
  return <Dashboard accessToken={INLINE_ACCESS_TOKEN} />;
}

function Dashboard({ accessToken }: { accessToken: string }) {
  const setGraph = useDashboardStore((s) => s.setGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setNameTranslations = useDashboardStore((s) => s.setNameTranslations);
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
        // domain-graph.json fetches in this file). Without
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

  // Excavator: the name table, present only when the page was packed with `--language`.
  useEffect(() => {
    readInlineFile("name-translations.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (data) setNameTranslations(data);
      })
      .catch(() => {});
  }, [setNameTranslations]);

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
  const codeViewerOpen = useDashboardStore((s) => s.codeViewerOpen);
  const codeViewerExpanded = useDashboardStore((s) => s.codeViewerExpanded);
  const expandCodeViewer = useDashboardStore((s) => s.expandCodeViewer);
  const collapseCodeViewer = useDashboardStore((s) => s.collapseCodeViewer);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const layoutIssues = useDashboardStore((s) => s.layoutIssues);
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const allIssues = useMemo(
    () => [...graphIssues, ...layoutIssues],
    [graphIssues, layoutIssues],
  );

  // Keyboard: Escape steps back one level, "/" focuses the search box.
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      {
        key: "Escape",
        description: "Close the code viewer, clear the selection, leave the layer or domain",
        action: () => {
          // Read from store at invocation time to avoid stale closures
          const state = useDashboardStore.getState();
          if (state.codeViewerExpanded) {
            state.collapseCodeViewer();
          } else if (state.codeViewerOpen) {
            state.closeCodeViewer();
          } else if (state.selectedNodeId) {
            state.selectNode(null);
          } else if (state.viewMode === "domain" && state.activeDomainId !== null) {
            state.clearActiveDomain();
          } else if (state.navigationLevel === "layer-detail") {
            state.navigateToOverview();
          }
        },
        category: "Navigation",
      },
      {
        key: "/",
        description: "Focus the search box",
        action: () => {
          const searchInput = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
          searchInput?.focus();
        },
        category: "Navigation",
      },
    ],
    [],
  );

  // Register keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  if (isMobile) {
    return (
      <MobileLayout
        accessToken={accessToken}
        loadError={loadError}
        allIssues={allIssues}
        graphFreshness={graphFreshness}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-root text-text-primary noise-overlay">
      {/* Header: the project name, the view switch, the search box and the language switch. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 sm:px-5 py-3 bg-surface border-b border-border-subtle shrink-0">
        <h1 className="font-heading text-base sm:text-lg text-text-primary tracking-wide truncate max-w-[160px] sm:max-w-[220px] lg:max-w-none shrink-0">
          {graph?.project.name ?? t.common.appName}
        </h1>
        <ViewSwitch />
        <SearchBar />
        <LanguageSwitch />
      </header>

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
        </div>

        {/* Right sidebar — telescopes at narrower widths */}
        <aside className="w-[260px] md:w-[300px] lg:w-[360px] shrink-0 bg-surface border-l border-border-subtle overflow-hidden">
          <SidePanel freshness={graphFreshness} issues={allIssues} />
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
    </div>
  );
}

export default App;
