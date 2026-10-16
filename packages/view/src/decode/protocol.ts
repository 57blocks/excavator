// Messages between the page and its data Worker. The Worker decodes the
// bundle (or reads a dropped directory) once, hands the decoded segments to the page by transfer, and stays
// alive to answer queries (search) over its own copy of the columns it needs.
import type { Query, QueryResult } from '../model/engine';

/** One file of a dropped or picked directory: its path relative to what was dropped, and the File itself. */
export interface DroppedFile {
  path: string;
  file: File;
}

export type WorkerRequest =
  | { type: 'decode'; payload: string }
  /** Read a dropped `.excavator/` directory with the bake's rules (task 9.1); answered like `decode`. */
  | { type: 'parse-dir'; files: DroppedFile[] }
  | { type: 'query'; id: number; query: Query };

export type WorkerMessage =
  | { type: 'decoded'; ok: true; segments: Record<string, unknown> }
  | { type: 'decoded'; ok: false; name: string; message: string }
  /** A long query (the first identifier search rebuilds the term index) reports progress. */
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; ok: true; result: QueryResult }
  | { type: 'result'; id: number; ok: false; name: string; message: string };

/** Every column buffer of every decoded table, for a zero-copy transfer. */
export function transferables(segments: Record<string, unknown>): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const value of Object.values(segments)) {
    if (value === null || typeof value !== 'object') continue;
    const columns = (value as { columns?: unknown }).columns;
    if (columns === null || typeof columns !== 'object') continue;
    for (const column of Object.values(columns as object)) {
      if (column instanceof Int32Array && column.buffer instanceof ArrayBuffer) buffers.add(column.buffer);
    }
  }
  return [...buffers];
}
