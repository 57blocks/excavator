/**
 * From the domain graph to what the domain view draws (openspec:
 * changes/viewer-app, design D12). One place of the view is a level:
 *   top     a card for each domain (summary, flow count, step count) and a link for each
 *           pair of domains that `cross_domain` edges join, with their descriptions;
 *   domain  a card for each flow the domain contains;
 *   flow    a card for each step, in the order of the `flow_step` weights, and a link from
 *           each step to the next. Those links are that order drawn as arrows: they are not
 *           edges of the domain graph, and the level says so.
 * Everything drawn comes from the payload; nothing is inferred. Layout is the structure
 * graph's own (`layoutNodes`: ELK layered, or its rectpacking grid for a dense top level),
 * and the links are straight lines between the borders of the cards.
 */

import { MarkerType, type Edge, type Node } from '@xyflow/react';

import { domainCounts, type DomainIndex, type DomainNode } from '../data/domain';
import type { DomainCardData } from '../components/graph/DomainNodes';
import { rangeText } from './code';
import { domainHash, type DomainPlace } from './domain-state';
import { CLUSTER_SIZE, COLUMN_OPTIONS, layoutNodes, type LevelLayout, type Size } from './graph-layout';

export interface DomainEntry {
  id: string;
  kind: 'domain' | 'flow' | 'step';
  label: string;
  summary: string;
  /** Flows a domain holds, and steps a domain or flow holds; null where the card has no such count. */
  flows: number | null;
  steps: number | null;
  /** A step's place in its flow and the `flow_step` weight that put it there. */
  position: number | null;
  weight: number | null;
  /** A flow's entry point, or a step's file and lines. */
  meta: string | null;
  /** Where a click on the card goes (a step has none: a click selects it). */
  openTo: { domain: string; flow: string | null } | null;
}

export interface DomainLink {
  id: string;
  source: string;
  target: string;
  kind: 'cross-domain' | 'sequence';
  /** What the edges of this pair say, one line each; empty for a sequence link. */
  lines: string[];
  /** Edges also run against the arrow (a pair joined in both directions). */
  backward: boolean;
}

export interface DomainCrumb {
  label: string;
  /** Where the crumb goes; null for the one that is the level itself. */
  hash: string | null;
}

export interface DomainLevel {
  place: DomainPlace;
  /** Names the level, so a camera or a layout is redone only for another one. */
  key: string;
  entries: DomainEntry[];
  links: DomainLink[];
  crumbs: DomainCrumb[];
  notes: string[];
  /** The flows and steps the cards of the level hold, summed. */
  flows: number;
  steps: number;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function entryOf(node: DomainNode, extra: Partial<DomainEntry>): DomainEntry {
  return { id: node.id, kind: node.type as DomainEntry['kind'], label: node.name, summary: text(node.summary), flows: null, steps: null, position: null, weight: null, meta: null, openTo: null, ...extra };
}

function entryPoint(flow: DomainNode): string | null {
  const meta = flow.domainMeta ?? {};
  const point = text(meta.entryPoint);
  const type = text(meta.entryType);
  if (point === '') return null;
  return type === '' ? point : `${point} (${type})`;
}

function stepFile(step: DomainNode): string | null {
  if (typeof step.filePath !== 'string' || step.filePath === '') return null;
  const lines = rangeText(step.lineRange);
  return lines === null ? step.filePath : `${step.filePath}:${lines}`;
}

/** One link for each pair of domains the cross_domain edges join, carrying what each edge says. */
function crossLinks(index: DomainIndex): DomainLink[] {
  const groups = new Map<string, { source: string; target: string; forward: string[]; back: string[]; both: { from: string; to: string; text: string }[] }>();
  for (const edge of index.crossDomain) {
    const [low, high] = edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source];
    const key = `${low.length}:${low}${high}`;
    let group = groups.get(key);
    if (!group) {
      group = { source: edge.source, target: edge.target, forward: [], back: [], both: [] };
      groups.set(key, group);
    }
    const name = (id: string) => index.nodesById.get(id)?.name ?? id;
    const description = text(edge.description);
    (group.source === edge.source ? group.forward : group.back).push(description);
    group.both.push({ from: name(edge.source), to: name(edge.target), text: description });
  }
  return [...groups.values()].map((group, i) => {
    const backward = group.back.length > 0;
    const lines = backward
      ? group.both.map((row) => `${row.from} to ${row.to}${row.text === '' ? '' : `: ${row.text}`}`)
      : group.forward.filter((line) => line !== '');
    return { id: `link:${i}`, source: group.source, target: group.target, kind: 'cross-domain', lines, backward };
  });
}

function notesOf(index: DomainIndex, place: DomainPlace): string[] {
  if (place.kind === 'flow') return ['The arrows follow the flow_step weights, in ascending order. They show the order of the steps and are not edges of the domain graph.'];
  if (place.kind === 'domain') return [];
  const notes = [...index.problems];
  const { flows, steps } = index.unplaced;
  if (flows.length > 0 || steps.length > 0) {
    const flowText = `${plural(flows.length, 'flow is', 'flows are')} in no domain`;
    const stepText = `${plural(steps.length, 'step is', 'steps are')} in no flow`;
    notes.push(`${flows.length > 0 && steps.length > 0 ? `${flowText} and ${stepText}` : flows.length > 0 ? flowText : stepText}; ${flows.length + steps.length === 1 ? 'it is' : 'they are'} not drawn.`);
  }
  return notes;
}

/** The level `place` shows. */
export function buildDomainLevel(index: DomainIndex, place: DomainPlace): DomainLevel {
  const top: DomainCrumb = { label: 'Domains', hash: place.kind === 'top' ? null : domainHash() };
  if (place.kind === 'top') {
    const entries = index.domains.map((domain) => entryOf(domain, { ...domainCounts(index, domain.id), openTo: { domain: domain.id, flow: null } }));
    return { place, key: 'top', entries, links: crossLinks(index), crumbs: [top], notes: notesOf(index, place), flows: sum(entries, 'flows'), steps: sum(entries, 'steps') };
  }
  if (place.kind === 'domain') {
    const entries = (index.flowsOf.get(place.domain.id) ?? []).map((flow) => entryOf(flow, {
      steps: index.stepsOf.get(flow.id)?.length ?? 0,
      meta: entryPoint(flow),
      openTo: { domain: place.domain.id, flow: flow.id },
    }));
    return { place, key: `domain:${place.domain.id}`, entries, links: [], crumbs: [top, { label: place.domain.name, hash: null }], notes: notesOf(index, place), flows: entries.length, steps: sum(entries, 'steps') };
  }
  const steps = index.stepsOf.get(place.flow.id) ?? [];
  const entries = steps.map((step) => entryOf(step.node, { position: step.position, weight: step.weight, meta: stepFile(step.node) }));
  const links: DomainLink[] = entries.slice(1).map((entry, i) => ({ id: `seq:${i}`, source: entries[i].id, target: entry.id, kind: 'sequence', lines: [], backward: false }));
  return {
    place,
    key: `flow:${place.domain.id}:${place.flow.id}`,
    entries,
    links,
    crumbs: [top, { label: place.domain.name, hash: domainHash({ domain: place.domain.id }) }, { label: place.flow.name, hash: null }],
    notes: notesOf(index, place),
    flows: 1,
    steps: entries.length,
  };
}

function sum(entries: readonly DomainEntry[], field: 'flows' | 'steps'): number {
  return entries.reduce((total, entry) => total + (entry[field] ?? 0), 0);
}

const SIZE: Record<DomainEntry['kind'], Size> = {
  domain: CLUSTER_SIZE,
  flow: CLUSTER_SIZE,
  step: { width: 320, height: 84 },
};

/**
 * A top level whose domains are joined by at least as many links as there are domains is a tangle when layered: it is packed as a
 * grid of three columns for nine domains (wide rather than tall, as a pane is), with straight links between the cards.
 */
const GRID_MIN_ENTRIES = 4;
const GRID_OPTIONS = { 'elk.aspectRatio': '2', 'elk.spacing.nodeNode': '40' } as const;

/** The steps of a flow are a column, closer together than the cards of the other levels. */
const STEP_COLUMN_OPTIONS = { ...COLUMN_OPTIONS, 'elk.layered.spacing.nodeNodeBetweenLayers': '20' } as const;

/** Whether `level` is laid out as a grid: a top level of at least GRID_MIN_ENTRIES domains with at least as many links. */
export function layoutsAsGrid(level: DomainLevel): boolean {
  return level.place.kind === 'top' && level.entries.length >= GRID_MIN_ENTRIES && level.links.length >= level.entries.length;
}

/** Place the level's cards by its links, with the structure graph's layout; the steps of a flow stay in one column. */
export function layoutDomainLevel(level: DomainLevel): Promise<LevelLayout> {
  const grid = layoutsAsGrid(level);
  return layoutNodes(
    level.entries.map((entry) => ({ id: entry.id, size: SIZE[entry.kind] })),
    level.links.map((link) => [link.source, link.target] as const),
    { grid, options: grid ? GRID_OPTIONS : level.place.kind === 'flow' ? STEP_COLUMN_OPTIONS : undefined },
  );
}

/** What the canvas knows beyond the level: the selection, the pointer, and what a click does. */
export interface DomainView {
  /** The domain, flow or step shown in the sidebar. */
  selected: string | null;
  hovered: string | null;
  hoveredEdge: string | null;
  onOpen: (entry: DomainEntry) => void;
  onSelect: (id: string) => void;
}

/** The React Flow nodes of a laid-out level. */
export function domainNodes(level: DomainLevel, layout: LevelLayout, view: Pick<DomainView, 'selected' | 'onOpen' | 'onSelect'>): Node<DomainCardData>[] {
  const nodes: Node<DomainCardData>[] = [];
  for (const entry of level.entries) {
    const box = layout.boxes.get(entry.id);
    if (!box) continue;
    nodes.push({
      id: entry.id,
      type: 'card',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      draggable: false,
      data: { entry, selected: view.selected === entry.id, onOpen: view.onOpen, onSelect: view.onSelect },
    });
  }
  return nodes;
}

export interface DomainEdgeData extends Record<string, unknown> {
  kind: DomainLink['kind'];
  /** The description lines of a cross-domain link, shown while the edge is labelled. */
  lines: string[];
  showLabel: boolean;
}

const INK = 'var(--color-ink-soft)';
const ACCENT = 'var(--color-accent)';

/**
 * The React Flow edges of a level. A cross-domain edge shows its description only while it is under the pointer:
 * the edges of a selected or hovered domain are lit but not described, because their boxes drawn together sit on each
 * other and on the cards (the sidebar lists the same edges with their descriptions). While one is active the edges that
 * do not touch it are dimmed, not left out.
 * The arrows of a flow are an order, not edges with a meaning of their own, and carry no label.
 */
export function domainEdges(level: DomainLevel, view: Pick<DomainView, 'selected' | 'hovered' | 'hoveredEdge'>): Edge<DomainEdgeData>[] {
  const active = [view.hovered, view.selected].filter((id): id is string => id !== null);
  const touches = (link: DomainLink) => active.includes(link.source) || active.includes(link.target);
  return level.links.map((link) => {
    const sequence = link.kind === 'sequence';
    const hovered = view.hoveredEdge === link.id;
    const lit = !sequence && (touches(link) || hovered);
    const dimmed = !sequence && (active.length > 0 || view.hoveredEdge !== null) && !lit;
    const colour = sequence ? INK : lit ? ACCENT : INK;
    const arrow = sequence ? 14 : 22;
    const marker = { type: MarkerType.ArrowClosed, width: arrow, height: arrow, color: colour, markerUnits: 'userSpaceOnUse' };
    return {
      id: link.id,
      source: link.source,
      target: link.target,
      type: 'link',
      focusable: false,
      selectable: false,
      zIndex: hovered ? 20 : lit ? 10 : 0,
      markerEnd: marker,
      ...(link.backward ? { markerStart: marker } : {}),
      data: { kind: link.kind, lines: link.lines, showLabel: !sequence && link.lines.length > 0 && hovered },
      style: sequence
        ? { stroke: INK, strokeOpacity: 0.55, strokeWidth: 2 }
        : { stroke: colour, strokeOpacity: dimmed ? 0.12 : lit ? 0.95 : 0.55, strokeWidth: 2, strokeDasharray: '6 4' },
    };
  });
}
