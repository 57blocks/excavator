import { useEffect, useMemo, useState } from "react";
import { STRUCTURAL_VISIBLE_TYPES } from "../components/GraphView";
import { useDashboardStore } from "../store";
import { relationIndex, type RelationIndex } from "./graphRelations";
import { describeProductState, productStateFromJson, readJson, snapshotRevisionOf, type ProductState } from "./productStates";
import { relationRows, unitsOf, type RelationRow, type UnitInfo } from "./products/relations";
import { containersOf, drawnInLayer } from "./views/graphTarget";
import { loadProductFile, type ProductFile } from "./views/productFiles";
import { isTable, type Table } from "./views/shared/shape";

/**
 * The relations product as the structural graph and the node panel read it. The graph draws relations only when
 * the packer judged the product included: a product that was not run, is unreadable, or was made from another
 * revision (its node ids may be ids into other facts) draws nothing, and the page says which and why.
 */

export type GraphRelationsData =
  | { status: "loading" }
  | { status: "unavailable"; word: string; lines: string[] }
  | {
      status: "ready";
      product: Table;
      rows: RelationRow[];
      units: ReadonlyMap<string, UnitInfo>;
      index: RelationIndex;
      /** A node's container, from the graph's `contains` edges. */
      parentOf: ReadonlyMap<string, string>;
      /** The nodes the structural view draws in some layer. */
      drawn: ReadonlySet<string>;
    };

type Loaded = { state: ProductState; snapshotRevision: string | null; file: ProductFile | null };

let pending: Promise<Loaded> | null = null;

/** Reads `products.json` and, when the relations product is included, its file; once per page. */
function loadOnce(): Promise<Loaded> {
  pending ??= readJson("products.json").then(async ({ value, failure }) => {
    const state = productStateFromJson(value, "relations", failure);
    return { state, snapshotRevision: snapshotRevisionOf(value), file: state.status === "included" ? await loadProductFile("relations-graph.json") : null };
  });
  return pending;
}

const WORDS: Record<string, string> = { "not-run": "not run", unreadable: "unreadable", "different-revision": "different revision" };

/** What the graph says for a product it does not draw, or null when it draws it. */
export function unavailableOf(loaded: Loaded): { word: string; lines: string[] } | null {
  const { state } = loaded;
  if (state.status !== "included") {
    return { word: WORDS[state.status] ?? state.status, lines: describeProductState(state, loaded.snapshotRevision) };
  }
  if (loaded.file === null || loaded.file.state === "missing") {
    return { word: "unreadable", lines: ["Status: unreadable", `Reason: ${loaded.file?.reason ?? "relations-graph.json is not in this page"}`] };
  }
  if (!isTable(loaded.file.value)) return { word: "unreadable", lines: ["Status: unreadable", "Reason: relations-graph.json is not in the expected shape"] };
  return null;
}

export function useGraphRelations(): GraphRelationsData {
  const graph = useDashboardStore((s) => s.graph);
  const nodeIdToLayerId = useDashboardStore((s) => s.nodeIdToLayerId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    void loadOnce().then((result) => {
      if (live) setLoaded(result);
    });
    return () => {
      live = false;
    };
  }, []);

  const product = loaded !== null && unavailableOf(loaded) === null && loaded.file?.state === "ready" ? (loaded.file.value as Table) : null;
  const rows = useMemo(() => (product === null ? [] : relationRows(product)), [product]);
  const units = useMemo(() => new Map(unitsOf(product).map((u) => [u.id, u])), [product]);
  const parentOf = useMemo(() => containersOf(graph?.edges ?? []), [graph]);
  const index = useMemo(() => relationIndex(rows, new Set((graph?.nodes ?? []).map((n) => n.id)), parentOf), [rows, graph, parentOf]);
  const drawn = useMemo(
    () => new Set((graph?.nodes ?? []).filter((n) => nodeIdToLayerId.has(n.id) && drawnInLayer(n.type, STRUCTURAL_VISIBLE_TYPES)).map((n) => n.id)),
    [graph, nodeIdToLayerId],
  );

  // One object per input, so the graph's memos (and its setNodes effect) do not run on every render.
  return useMemo((): GraphRelationsData => {
    if (loaded === null) return { status: "loading" };
    const unavailable = unavailableOf(loaded);
    if (unavailable !== null || product === null) return { status: "unavailable", ...(unavailable ?? { word: "unreadable", lines: [] }) };
    return { status: "ready", product, rows, units, index, parentOf, drawn };
  }, [loaded, product, rows, units, index, parentOf, drawn]);
}
