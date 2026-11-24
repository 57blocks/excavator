import type { ExternalRow, LinkRow, RelationRow } from "../../products/relations";

/** The row chosen in the Relations view: a relation, a link between units, or an external system. */
export type RelationsRowRef =
  | { table: "sites"; row: RelationRow }
  | { table: "links"; row: LinkRow }
  | { table: "externals"; row: ExternalRow };

const TABLES = new Set(["sites", "links", "externals"]);

export const isRelationsRowRef = (value: unknown): value is RelationsRowRef =>
  typeof value === "object" && value !== null && TABLES.has((value as { table?: unknown }).table as string) && typeof (value as { row?: unknown }).row === "object";
