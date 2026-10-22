import { createContext, useContext, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';

import { replaceHash, useRoute } from '../hooks/use-route';
import { filtersHash, overlaysHash } from '../lib/graph-actions';
import { filterParams, type GraphFilters } from '../lib/graph-filters';
import { parseGraphState } from '../lib/graph-state';
import { parseRoute } from '../lib/route';
import type { OverlayName } from '../lib/overlay-names';
import type { Mode } from '../lib/view-mode';
import type { ViewPlaces } from '../lib/view-switch';

/** The one dialog, menu or result list that is open; Esc closes it before anything else. */
export type Overlay = 'search' | 'filters' | 'overlays' | 'path' | 'shortcuts' | null;

export type DrawerState = 'closed' | 'open' | 'full';

interface GraphUi {
  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;
  /** The filters and the overlays are read from the address (they are the graph's, and a reload restores them). */
  filters: GraphFilters;
  setFilters: (update: (filters: GraphFilters) => GraphFilters) => void;
  overlays: readonly OverlayName[];
  setOverlays: (update: (overlays: readonly OverlayName[]) => readonly OverlayName[]) => void;
  drawer: DrawerState;
  setDrawer: (drawer: DrawerState) => void;
  /** The search box, so `/` can focus it. */
  searchInput: MutableRefObject<HTMLInputElement | null>;
  /** Set by the graph page while it is shown: closes the next thing Esc closes, and says whether it closed one. */
  escape: MutableRefObject<(() => boolean) | null>;
  /** The node a search or a selection switched the mode for, and the mode it left; the sidebar says so while that node is selected. */
  modeSwitch: { node: string; from: Mode } | null;
  setModeSwitch: (value: { node: string; from: Mode } | null) => void;
  /**
   * Whether the sidebar shows the project overview or the tour when nothing is selected. It starts open only on a window of
   * IDLE_OPEN_QUERY, where the canvas keeps room beside it; closing or opening it holds until it is changed again.
   */
  idleOpen: boolean;
  setIdleOpen: (open: boolean) => void;
  /** The last address of the structure graph and of the domain view, so the Domain | Structural switch returns each to where it was. */
  places: MutableRefObject<ViewPlaces>;
}

const GraphUiContext = createContext<GraphUi | null>(null);

/**
 * The windows the idle sidebar starts open on: from this width the canvas keeps 880 px beside the 200 px navigation and the
 * 360 px sidebar. On a narrower one it starts closed (at 768 px and below the sidebar covers the page), and the graph's
 * top card has the button that opens it.
 */
export const IDLE_OPEN_QUERY = '(min-width: 1440px)';
const idleOpenAtStart = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(IDLE_OPEN_QUERY).matches;

/** The graph state of the address as it is now; the setters read it when they run, so two changes in a row both count. */
const currentState = () => parseGraphState(parseRoute(window.location.hash).params);

/** The state that the top bar, the graph page and the shortcuts share: the open dialog, the filters and overlays of the address, and the code drawer. */
export function GraphUiProvider({ children }: { children: ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [drawer, setDrawer] = useState<DrawerState>('closed');
  const searchInput = useRef<HTMLInputElement | null>(null);
  const escape = useRef<(() => boolean) | null>(null);
  const [modeSwitch, setModeSwitch] = useState<{ node: string; from: Mode } | null>(null);
  const [idleOpen, setIdleOpen] = useState(idleOpenAtStart);
  const places = useRef<ViewPlaces>({ graph: null, domain: null });
  const { route } = useRoute();
  const state = useMemo(() => parseGraphState(route.params), [route]);
  // The sets are new on every parse; the filters stay one object while their text is the same.
  const filtersKey = JSON.stringify(filterParams(state.filters));
  const filters = useMemo(() => state.filters, [filtersKey]);
  const overlaysKey = state.overlays.join(',');
  const overlays = useMemo(() => state.overlays, [overlaysKey]);
  const value = useMemo<GraphUi>(
    () => ({
      overlay,
      setOverlay,
      filters,
      setFilters: (update) => {
        const now = currentState();
        replaceHash(filtersHash(now, update(now.filters)));
      },
      overlays,
      setOverlays: (update) => {
        const now = currentState();
        replaceHash(overlaysHash(now, update(now.overlays)));
      },
      drawer,
      setDrawer,
      searchInput,
      escape,
      modeSwitch,
      setModeSwitch,
      idleOpen,
      setIdleOpen,
      places,
    }),
    [overlay, filters, overlays, drawer, modeSwitch, idleOpen],
  );
  return <GraphUiContext.Provider value={value}>{children}</GraphUiContext.Provider>;
}

export function useGraphUi(): GraphUi {
  const ui = useContext(GraphUiContext);
  if (!ui) throw new Error('useGraphUi was used outside a GraphUiProvider');
  return ui;
}
