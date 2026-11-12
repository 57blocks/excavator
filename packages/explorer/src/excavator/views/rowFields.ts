/**
 * The labelled fields of a row's details, as text (openspec: changes/explorer-products,
 * design D4). A field the product does not hold reads "not provided by the product",
 * never 0 or an empty string; a field the product holds as null is left empty (null).
 */

import { numberField, plainField } from "../products/hotspots";
import { NOT_PROVIDED } from "../products/format";
import type { UnusedRow } from "../products/unused";
import { lineText, sourceRange } from "./codeAction";

export interface FieldText {
  label: string;
  text: string | null;
}

type Row = Record<string, any>;

/** The path of a directory row, with the project root said in words. */
export const directoryName = (path: unknown): string => (path === "." ? ". (the project root)" : String(path));

export function unusedFields(row: UnusedRow): FieldText[] {
  const lines = lineText(sourceRange(row.lineRange));
  return [
    { label: "Name", text: row.name },
    { label: "Id", text: row.id },
    { label: "Owner", text: row.owner },
    { label: "Language", text: row.language },
    { label: "Location", text: row.file === null ? null : row.file + (lines ? `:${lines}` : "") },
    { label: "Visibility", text: row.visibility },
    { label: "Reason", text: row.reason },
    { label: "Confidence", text: row.confidence },
    { label: "Group", text: row.group === null ? null : String(row.group) },
  ];
}

export function fileFields(row: Row): FieldText[] {
  return [
    { label: "Path", text: String(row.path) },
    { label: "Score", text: numberField(row.score) },
    { label: "Commits", text: numberField(row.commits) },
    { label: "Authors", text: numberField(row.authors) },
    { label: "Added", text: numberField(row.added) },
    { label: "Removed", text: numberField(row.removed) },
    { label: "Lines", text: numberField(row.lines) },
    { label: "Last changed", text: plainField(row.lastChanged) },
    { label: "Lineage conflicts", text: numberField(row.lineageConflicts) },
  ];
}

const concentration = (row: Row, field: string): unknown => {
  if (row.concentration === undefined) return undefined;
  return row.concentration === null ? null : row.concentration[field];
};

const concentrationNumber = (row: Row, field: string): string | null => {
  const value = concentration(row, field);
  return value === undefined ? NOT_PROVIDED : numberField(value as number | null);
};

export function directoryFields(row: Row): FieldText[] {
  const share = concentration(row, "topAuthorShare");
  return [
    { label: "Path", text: directoryName(row.path) },
    { label: "Score", text: numberField(row.score) },
    { label: "Commits", text: numberField(row.commits) },
    { label: "Authors", text: numberField(row.authors) },
    { label: "Files", text: numberField(row.files) },
    { label: "Lines", text: numberField(row.lines) },
    { label: "Added", text: numberField(row.added) },
    { label: "Removed", text: numberField(row.removed) },
    { label: "Last changed", text: plainField(row.lastChanged) },
    { label: "Commits by people", text: concentrationNumber(row, "commitsByPeople") },
    { label: "Top author share", text: share === undefined ? NOT_PROVIDED : share === null ? null : String(share) },
    { label: "Authors for 80%", text: concentrationNumber(row, "authorsFor80Percent") },
  ];
}

