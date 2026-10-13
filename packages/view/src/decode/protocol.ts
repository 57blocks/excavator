// Messages between the page and its decode Worker.

export interface DecodeRequest {
  payload: string;
}

export type DecodeResponse =
  | { ok: true; segments: Record<string, unknown> }
  | { ok: false; name: string; message: string };

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
