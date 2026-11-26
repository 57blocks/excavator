import type { ExternalRow, LinkRow, RelationRow } from "../../products/relations";

/**
 * The row chosen in the Relations view: a relation, a link between units, or an external system. `reveal` marks a row
 * chosen from outside the view (the graph or the node panel): the view then shows the row's table, even when it is
 * already open on another one.
 */
export type RelationsRowRef =
  | { table: "sites"; row: RelationRow; reveal?: boolean }
  | { table: "links"; row: LinkRow; reveal?: boolean }
  | { table: "externals"; row: ExternalRow; reveal?: boolean };

const TABLES = new Set(["sites", "links", "externals"]);

export const isRelationsRowRef = (value: unknown): value is RelationsRowRef =>
  typeof value === "object" && value !== null && TABLES.has((value as { table?: unknown }).table as string) && typeof (value as { row?: unknown }).row === "object";
