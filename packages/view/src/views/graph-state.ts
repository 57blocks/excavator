// Page-lifetime state shared by the graph levels: the CSR adjacency build
// in the data Worker (lazy, on the first graph or node route, with progress),
// which edge types are switched off in the legend, and what each level looked
// like when the reader left it (node positions, pins and the viewport), so a
// breadcrumb back restores it unchanged.
import { useEffect, useSyncExternalStore } from 'react';
import type { ViewData } from '../data';
import { mainThreadQueries, type QueryService } from '../decode/queries';
import type { Query, QueryResult } from '../model/engine';
import type { GraphInitResult } from '../model/graph-model';
import { clearBusy, markBusy, report } from '../instrument';

let fallback: { data: ViewData; service: QueryService } | null = null;

export function serviceFor(data: ViewData): QueryService {
  if (data.queries) return data.queries;
  if (fallback?.data !== data) fallback = { data, service: mainThreadQueries(data.segments) };
  return fallback.service;
}

/** Run a query with #root marked busy until it answers (the smoke check waits on that). */
export function runQuery<T extends QueryResult>(data: ViewData, key: string, query: Query, onProgress?: (done: number, total: number) => void): Promise<T> {
  markBusy(key);
  return serviceFor(data)
    .run(query, onProgress)
    .then((r) => r as T)
    .finally(() => clearBusy(key));
}

// --- CSR build -------------------------------------------------------------

export type CsrState =
  | { state: 'idle' }
  | { state: 'building'; done: number; total: number }
  | { state: 'ready'; result: GraphInitResult }
  | { state: 'error'; message: string };

let csr: CsrState = { state: 'idle' };
/** The data set the CSR state belongs to, and a generation so an answer for replaced data is dropped. */
let csrData: ViewData | null = null;
let csrGeneration = 0;
let csrBuilds = 0;
const csrListeners = new Set<() => void>();

function setCsr(next: CsrState) {
  csr = next;
  report('data-csr', next.state);
  if (next.state === 'ready') report('data-csr-ms', Math.round(next.result.buildMs));
  for (const l of csrListeners) l();
}

function startCsr(data: ViewData) {
  if (csrData !== data) resetGraphState(data);
  if (csr.state !== 'idle') return;
  const generation = csrGeneration;
  const current = () => generation === csrGeneration;
  csrBuilds += 1;
  report('data-csr-builds', csrBuilds);
  setCsr({ state: 'building', done: 0, total: 0 });
  runQuery<GraphInitResult>(data, 'csr', { op: 'graph-init' }, (done, total) => {
    if (current() && csr.state === 'building') setCsr({ state: 'building', done, total });
  }).then(
    (result) => current() && setCsr({ state: 'ready', result }),
    (error: unknown) => current() && setCsr({ state: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
}

/**
 * New data mounted over the old (a dropped directory, task 9.4): the CSR
 * goes back to "not built" (a pending build for the old data is ignored when
 * it answers), and the remembered level positions, pins, viewports and edge
 * type switches are dropped so nothing of the old graph is applied to the new
 * one. The next graph route builds the CSR again, with its progress bar.
 */
export function resetGraphState(data: ViewData | null): void {
  csrData = data;
  csrGeneration += 1;
  memory.clear();
  report('data-graph-memory-levels', 0);
  lastActivation = null;
  if (disabled.size > 0) {
    disabled = new Set();
    for (const l of typeListeners) l();
  }
  if (csr.state !== 'idle') setCsr({ state: 'idle' });
}

/** The CSR build state; the first caller starts the build. */
export function useCsr(data: ViewData): CsrState {
  useEffect(() => startCsr(data), [data]);
  return useSyncExternalStore(
    (l) => {
      csrListeners.add(l);
      return () => csrListeners.delete(l);
    },
    () => csr,
  );
}

// --- edge type switches -----------------------------------------------------

let disabled: ReadonlySet<string> = new Set();
const typeListeners = new Set<() => void>();

/** Legend keys (edge types, or "other") switched off. */
export function useDisabledTypes(): [ReadonlySet<string>, (key: string) => void] {
  const value = useSyncExternalStore(
    (l) => {
      typeListeners.add(l);
      return () => typeListeners.delete(l);
    },
    () => disabled,
  );
  const toggle = (key: string) => {
    const next = new Set(disabled);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    disabled = next;
    for (const l of typeListeners) l();
  };
  return [value, toggle];
}

// --- level memory -----------------------------------------------------------

export interface SavedNode {
  x: number;
  y: number;
  pinned: boolean;
}

export interface Transform {
  k: number;
  x: number;
  y: number;
}

export interface LevelMemory {
  nodes: Map<string, SavedNode>;
  transform: Transform;
}

const memory = new Map<string, LevelMemory>();

export function levelMemory(level: string): LevelMemory | undefined {
  return memory.get(level);
}

export function saveLevel(level: string, saved: LevelMemory): void {
  memory.set(level, saved);
  report('data-graph-memory-levels', memory.size);
}

/** Where (in screen pixels inside the canvas) the reader last opened a node, for the next level's expand transition. */
export let lastActivation: { level: string; x: number; y: number } | null = null;

export function setLastActivation(value: { level: string; x: number; y: number } | null): void {
  lastActivation = value;
}

// --- layer coloring (task 8.2) -----------------------------------------------

let layerColoring = false;
const layerListeners = new Set<() => void>();

/** Whether graph nodes are colored by architecture layer, for every level. */
export function useLayerColoring(): [boolean, () => void] {
  const value = useSyncExternalStore(
    (l) => {
      layerListeners.add(l);
      return () => layerListeners.delete(l);
    },
    () => layerColoring,
  );
  const toggle = () => {
    layerColoring = !layerColoring;
    for (const l of layerListeners) l();
  };
  return [value, toggle];
}
