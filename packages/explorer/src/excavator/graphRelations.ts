/**
 * The relations product as the structural graph draws it: which relations can be drawn, where each end sits in the
 * view shown, and the edges and stand-in nodes that result. Pure functions over the product's rows and the knowledge
 * graph's node ids; nothing here is written back into either graph.
 *
 * Rules, as the PR that added this states them:
 *   - only a linked relation is drawn: its caller end's node and its receiver end's node (or its external system)
 *     must be known. A relation that is not linked (caller-only, receiver-only, address-unresolved, ambiguous,
 *     quote-failed) is never drawn, so nothing reads as a pair the product did not make; the node panel and the
 *     Relations view list it with its bucket;
 *   - a linked relation with an end whose node id the knowledge graph does not have is not drawn;
 *   - an end is placed at the nearest node the view draws that is the end's node or contains it (a function end at its
 *     file), then at the folder box that holds that node while the box is closed, as the copy's own edges are;
 *   - an end in another layer is placed at one stand-in node for that layer, an external system at one node per id;
 *   - a drawable relation with an end that no layer holds (no node a layer draws is the end's node or contains it) is
 *     drawn in no view, and is counted;
 *   - relations whose two ends land on the same pair of drawn nodes are one edge per kind, labelled with the kind;
 *     two ends on the same drawn node give no edge, and neither does a relation whose two ends are both stand-ins.
 */

import { missingEndText, type RelationRow, type RelationSite } from "./products/relations";

export type RelationsMode = "off" | "selected" | "all";

/** The id prefix of the nodes this module adds to the view. */
export const STAND_IN_PREFIX = "relations:";
export const layerStandInId = (layerId: string): string => `${STAND_IN_PREFIX}layer:${layerId}`;
export const externalStandInId = (externalId: string): string => `${STAND_IN_PREFIX}${externalId}`;
export const isStandInId = (id: string): boolean => id.startsWith(STAND_IN_PREFIX);

/** How an edge of each kind is drawn: a colour of the theme and a dash pattern, both differing per kind. */
export const KIND_STYLES: Readonly<Record<string, { stroke: string; dash: string }>> = {
  http: { stroke: "var(--color-node-endpoint)", dash: "6 4" },
  rpc: { stroke: "var(--color-node-service)", dash: "2 3" },
  message: { stroke: "var(--color-node-pipeline)", dash: "10 4 2 4" },
  realtime: { stroke: "var(--color-node-config)", dash: "4 2" },
  external: { stroke: "var(--color-node-resource)", dash: "1 4" },
};
const OTHER_KIND_STYLE = { stroke: "var(--color-text-muted)", dash: "3 3" };
export const kindStyle = (kind: string) => KIND_STYLES[kind] ?? OTHER_KIND_STYLE;

/** A linked relation whose ends the graph can draw. */
export interface GraphRelation {
  row: RelationRow;
  kind: string;
  /** The caller end's node id. */
  caller: string;
  /** The receiver end's node id, or the external system's id. */
  receiver: string;
  external: boolean;
}

/** A relation listed under a node: the node is the end's node or contains it. */
export interface NodeRelation {
  row: RelationRow;
  role: "caller" | "receiver";
  /** The end's own node id. */
  endNodeId: string;
}

export interface RelationIndex {
  total: number;
  linked: number;
  drawable: GraphRelation[];
  /** Linked relations with an end whose node id is not in the knowledge graph (or that records none). */
  notInGraph: RelationRow[];
  /** Relations in any other bucket than linked. */
  notLinked: number;
  /** Every node id that is an end's node or contains one, with those relations. */
  byNode: ReadonlyMap<string, NodeRelation[]>;
}

/** The node and every node containing it, nearest first; a cycle in the contains edges stops the walk. */
export function selfAndContainers(nodeId: string, parentOf: ReadonlyMap<string, string>): string[] {
  const chain = [nodeId];
  for (let up = parentOf.get(nodeId); up !== undefined && !chain.includes(up); up = parentOf.get(up)) chain.push(up);
  return chain;
}

export function relationIndex(rows: readonly RelationRow[], nodeIds: ReadonlySet<string>, parentOf: ReadonlyMap<string, string>): RelationIndex {
  const drawable: GraphRelation[] = [];
  const notInGraph: RelationRow[] = [];
  const byNode = new Map<string, NodeRelation[]>();
  let linked = 0;
  const known = (id: string | null | undefined): id is string => typeof id === "string" && nodeIds.has(id);
  for (const row of rows) {
    for (const role of ["caller", "receiver"] as const) {
      const endNodeId = row[role]?.nodeId;
      if (!known(endNodeId)) continue;
      for (const id of selfAndContainers(endNodeId, parentOf)) {
        const list = byNode.get(id) ?? [];
        list.push({ row, role, endNodeId });
        byNode.set(id, list);
      }
    }
    if (row.bucket !== "linked") continue;
    linked += 1;
    const caller = row.caller?.nodeId;
    const receiver = row.external ?? row.receiver?.nodeId;
    if (row.kind !== null && known(caller) && (row.external !== null || known(receiver))) {
      drawable.push({ row, kind: row.kind, caller, receiver: receiver as string, external: row.external !== null });
    } else {
      notInGraph.push(row);
    }
  }
  return { total: rows.length, linked, drawable, notInGraph, notLinked: rows.length - linked, byNode };
}

/** The drawable relations of one node: those whose caller or receiver end is the node or a node it contains. */
export function relationsOfNode(index: RelationIndex, nodeId: string): GraphRelation[] {
  const rows = new Set((index.byNode.get(nodeId) ?? []).map((entry) => entry.row));
  return index.drawable.filter((relation) => rows.has(relation.row));
}

export interface StandIn {
  id: string;
  kind: "layer" | "external";
  /** The layer id or the external system id. */
  key: string;
}

export interface RelationEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  relations: RelationRow[];
}

export interface Projection {
  edges: RelationEdge[];
  standIns: StandIn[];
  /** Relations that are an edge in this view. */
  drawn: number;
  /** Relations with at least one end on a node or box the view draws (not a stand-in); `drawn` of them are edges. */
  inView: number;
}

/**
 * The edges of `relations` in a view whose `place` gives, for a graph node id, the id of the drawn node or box it sits
 * at (or a layer stand-in id), or null when the view does not show it.
 */
export function projectRelations(relations: readonly GraphRelation[], place: (nodeId: string) => string | null): Projection {
  const edges = new Map<string, RelationEdge>();
  const standIns = new Map<string, StandIn>();
  const prefix = `${STAND_IN_PREFIX}layer:`;
  const note = (id: string) => {
    if (id.startsWith(prefix)) standIns.set(id, { id, kind: "layer", key: id.slice(prefix.length) });
  };
  let drawn = 0;
  let inView = 0;
  const onView = (id: string | null) => id !== null && !isStandInId(id);
  for (const relation of relations) {
    const source = place(relation.caller);
    const target = relation.external ? externalStandInId(relation.receiver) : place(relation.receiver);
    if (onView(source) || onView(target)) inView += 1;
    // Two stand-ins: neither end is in the view shown, so the relation is not this view's.
    if (source === null || target === null || source === target || (isStandInId(source) && isStandInId(target))) continue;
    note(source);
    note(target);
    if (relation.external) standIns.set(target, { id: target, kind: "external", key: relation.receiver });
    const id = `relation|${relation.kind}|${source}|${target}`;
    const edge = edges.get(id) ?? { id, source, target, kind: relation.kind, relations: [] };
    edge.relations.push(relation.row);
    edges.set(id, edge);
    drawn += 1;
  }
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { edges: [...edges.values()].sort(byId), standIns: [...standIns.values()].sort(byId), drawn, inView };
}

/** The relations `place` cannot place an end of: with the overview's placer, those with an end that no layer holds. */
export function unplacedRelations(relations: readonly GraphRelation[], place: (nodeId: string) => string | null): GraphRelation[] {
  return relations.filter((relation) => place(relation.caller) === null || (!relation.external && place(relation.receiver) === null));
}

/** The nearest node in `drawn` that is the node or contains it, or null when none is. */
export function drawnHome(nodeId: string, drawn: ReadonlySet<string>, parentOf: ReadonlyMap<string, string>): string | null {
  return selfAndContainers(nodeId, parentOf).find((id) => drawn.has(id)) ?? null;
}

/** Where the overview puts a node: the layer cluster of its drawn home. */
export function overviewPlacer(home: (nodeId: string) => string | null, layerOf: ReadonlyMap<string, string>) {
  return (nodeId: string): string | null => {
    const at = home(nodeId);
    return at === null ? null : layerOf.get(at) ?? null;
  };
}

/**
 * Where a layer's view puts a node: its drawn home when the view shows it, else the box holding that home when the
 * box is shown; a home in another layer goes to that layer's stand-in; null when the view shows neither.
 */
export function layerPlacer(args: {
  home: (nodeId: string) => string | null;
  layerOf: ReadonlyMap<string, string>;
  layersOf: ReadonlyMap<string, ReadonlySet<string>>;
  activeLayerId: string;
  shown: ReadonlySet<string>;
  boxOf: ReadonlyMap<string, string>;
}) {
  const { home, layerOf, layersOf, activeLayerId, shown, boxOf } = args;
  return (nodeId: string): string | null => {
    const at = home(nodeId);
    if (at === null) return null;
    if (!(layersOf.get(at)?.has(activeLayerId) ?? false)) {
      const other = layerOf.get(at);
      return other === undefined ? null : layerStandInId(other);
    }
    if (shown.has(at)) return at;
    const box = boxOf.get(at);
    return box !== undefined && shown.has(box) ? box : null;
  };
}

/** The other end of an entry in the node panel. */
export type OtherEnd =
  | { kind: "external"; id: string }
  | { kind: "node"; nodeId: string; site: RelationSite }
  | { kind: "not-in-graph"; site: RelationSite }
  | { kind: "missing"; text: string };

/** One relation as the node panel lists it. */
export interface CommunicationEntry {
  key: string;
  row: RelationRow;
  role: "caller" | "receiver";
  /** The end's own node; the node listed under is it or contains it. */
  endNodeId: string;
  /** This end's site. */
  site: RelationSite | null;
  /** The other end's unit id, or the external system's id. */
  otherUnit: string | null;
  other: OtherEnd;
}

const entryOrder = (a: CommunicationEntry, b: CommunicationEntry): number => {
  const key = (e: CommunicationEntry) => [e.row.bucket === "linked" ? "0" : "1", e.row.kind ?? "", e.row.address ?? "", e.row.id, e.role].join("\u0000");
  const x = key(a);
  const y = key(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * The relations listed under a node, linked first, then by kind, address and id. The other end is the external system,
 * the other site's node when the graph has it, the other site alone when it does not, or the sentence the Relations
 * view gives for an end with no site.
 */
export function communicationEntries(index: RelationIndex, nodeId: string, inGraph: (id: string) => boolean): CommunicationEntry[] {
  return (index.byNode.get(nodeId) ?? [])
    .map(({ row, role, endNodeId }): CommunicationEntry => {
      const site = role === "caller" ? row.caller : row.receiver;
      const otherSite = role === "caller" ? row.receiver : row.caller;
      let other: OtherEnd;
      if (row.external !== null && role === "caller") other = { kind: "external", id: row.external };
      else if (otherSite === null) {
        other = { kind: "missing", text: missingEndText(row, role === "caller" ? "receiver" : "caller") ?? `No ${role === "caller" ? "receiving" : "caller"} site recorded (${row.bucket}).` };
      } else if (otherSite.nodeId !== null && inGraph(otherSite.nodeId)) other = { kind: "node", nodeId: otherSite.nodeId, site: otherSite };
      else other = { kind: "not-in-graph", site: otherSite };
      return { key: `${row.id}:${role}`, row, role, endNodeId, site, otherUnit: row.external ?? otherSite?.unit ?? null, other };
    })
    .sort(entryOrder);
}

/** An edge's label: the kind of the relations it holds, never how many there are. */
export const edgeLabel = (kind: string): string => kind;

/** The words under a stand-in node: what kind of node it is, never how many relations reach it. */
export const standInNote = (kind: StandIn["kind"]): string => (kind === "external" ? "External system" : "Another layer");

export interface NotDrawnInput {
  mode: RelationsMode;
  level: "overview" | "layer-detail";
  hasSelection: boolean;
  /** Relations drawn as edges in this view, and relations with an end on a node or box this view draws. */
  drawn: number;
  inView: number;
  /** Drawable relations with an end no layer holds; linked relations with an end not in the graph; relations not linked. */
  inNoLayer: number;
  notInGraph: number;
  notLinked: number;
}

/**
 * The one muted sentence under the Relations control: null when every relation is drawn, else what is not drawn and
 * why, without any number (the counts are in the relations product, not on the page).
 */
export function relationsNotDrawnSentence(input: NotDrawnInput): string | null {
  if (input.mode === "off") return "No relations are drawn.";
  if (input.level === "layer-detail" && input.mode === "selected" && !input.hasSelection) return "Select a node to draw its relations.";
  const reasons: string[] = [];
  if (input.inView > input.drawn) reasons.push("an end is hidden in this view");
  if (input.inNoLayer > 0) reasons.push("an end is in no layer");
  if (input.notInGraph > 0) reasons.push("an end is not in the graph");
  if (input.notLinked > 0) reasons.push("some are not linked");
  return reasons.length === 0 ? null : `Some relations are not drawn: ${reasons.join(", ")}.`;
}
