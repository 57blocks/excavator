/**
 * The row chosen in the Hotspots view: which table it is from and the product's row. Only
 * file and directory rows have details; the two tables have rows of the same shape, so
 * the table is part of the row's identity.
 */
export interface HotspotsRowRef {
  table: "files" | "directories";
  row: Record<string, any>;
}

export const isHotspotsRowRef = (value: unknown): value is HotspotsRowRef =>
  typeof value === "object" && value !== null && ((value as HotspotsRowRef).table === "files" || (value as HotspotsRowRef).table === "directories");
