// The data of the offline page. The upstream dashboard fetched six data files
// and a source file from its dev server; the offline page has no server, so
// the packing step writes them into the page (openspec: changes/viewer-explorer,
// design D2; changes/explorer-chunked-data, design D2-D4). The data is the same
// object as before, keyed by the original file names:
//
//   "knowledge-graph.json": <the knowledge graph, as the upstream file>,
//   "domain-graph.json":    <the domain graph>,
//   "meta.json":            <the meta file>,
//   "diff-overlay.json":    <the diff overlay>,
//   "config.json":          <the config>,
//   "staleness.json":       <the freshness report>,
//   "unused-code.json", "hotspots.json", "doc-map.json", "doc-map-checks.json":
//                           <the product files, when their products were packed>,
//   "products.json":        <{ products: [{ name, status, reason, revision, revisionNote, command }] }>,
//   "sources": { "<node.filePath>": { path, language, content, sizeBytes, lineCount } },
//
// but it is held as gzip-compressed parts, each decoding to a JSON text small
// enough to be one string: a script `<script type="application/json"
// id="xv-explorer-index">` says which parts hold each data file (its top-level
// arrays are cut by element, the other fields are in header parts) and which part
// holds each source path, and `<script type="application/octet-stream"
// id="xv-part-<n>">` holds a part as base64. A data file is decoded the first time
// it is read, a source part the first time one of its files is read; the index
// alone answers `hasInlineFile` and `hasInlineSource`.
//
// A key that is absent (or null) is a file the server did not have: a read
// answers with the 404 and the `{ error }` body the upstream server sent, so
// each caller takes the branch it already had for a failed request and the
// dashboard shows its own empty state. `sources` is keyed by the path a node
// carries in `filePath`, and a value has the shape the upstream
// `/file-content.json` answered with. A part that cannot be decoded answers
// with a 500 and the reason in `error`, the same branch.
//
// The `data` parameter of each function is a test seam: an already-decoded
// object that is read directly.

/** The access token of the offline page: there is no gate, so it is always accepted. */
export const INLINE_ACCESS_TOKEN = "inline";

export type InlineDataFile =
  | "knowledge-graph.json"
  | "domain-graph.json"
  | "meta.json"
  | "diff-overlay.json"
  | "config.json"
  // Excavator: the product files the explorer-products views read.
  | "staleness.json"
  | "unused-code.json"
  | "hotspots.json"
  | "doc-map.json"
  | "doc-map-checks.json"
  | "products.json";

export interface InlineSource {
  path: string;
  language: string;
  content: string;
  sizeBytes: number;
  lineCount: number;
}

/** What a caller of the original `fetch` used: `ok`, `status` and `json()`. */
export type InlineResponse = Pick<Response, "ok" | "status" | "json">;

type Table = Record<string, unknown>;

function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An own, non-null value of a table; a name inherited from the prototype is not a key. */
function own(table: unknown, key: string): unknown {
  if (!isTable(table) || !Object.prototype.hasOwnProperty.call(table, key)) return undefined;
  return table[key] ?? undefined;
}

function found(value: unknown): Promise<InlineResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
}

function notFound(message: string): Promise<InlineResponse> {
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: message }) });
}

function unreadable(message: string): Promise<InlineResponse> {
  return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: message }) });
}

/** Where the data comes from: an object that is already decoded, or the page's index and parts. */
interface Store {
  hasFile(name: string): boolean;
  readFile(name: string): Promise<unknown>;
  hasSource(path: string): boolean;
  readSource(path: string): Promise<unknown>;
}

/** A data object that is already decoded (the test seam). */
function plainStore(data: unknown): Store {
  return {
    hasFile: (name) => own(data, name) !== undefined,
    readFile: (name) => Promise.resolve(own(data, name)),
    hasSource: (path) => own(own(data, "sources"), path) !== undefined,
    readSource: (path) => Promise.resolve(own(own(data, "sources"), path)),
  };
}

// ---- the page's index and parts -------------------------------------------------------------

export const INDEX_ID = "xv-explorer-index";
const partId = (n: number): string => `xv-part-${n}`;

interface IndexField {
  key: string;
  /** A plain field: the header part that holds it. */
  part?: number;
  /** An array field: the parts that hold its elements, in order. */
  parts?: number[];
}
type IndexEntry = { value: number } | { fields: IndexField[] } | { paths: Record<string, number> };

/** The part of the DOM the page reads: elements by id and their text. */
export interface PartDocument {
  getElementById(id: string): { textContent: string | null } | null;
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One part's JSON, decoded: base64, then gzip, then JSON. Nothing is requested. */
async function decodePart(doc: PartDocument, n: number): Promise<unknown> {
  const element = doc.getElementById(partId(n));
  if (!element) throw new Error(`part ${n} is not in this page`);
  const blob = new Blob([base64ToBytes(element.textContent ?? "") as BlobPart]);
  const text = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text);
}

/** A data file put back together from its parts, the fields in the order they were packed. */
async function assembleFile(doc: PartDocument, entry: IndexEntry): Promise<unknown> {
  if ("value" in entry) return decodePart(doc, entry.value);
  if (!("fields" in entry)) return undefined;
  const headers = new Map<number, Table>();
  const file: Table = {};
  for (const field of entry.fields) {
    let value: unknown;
    if (field.parts) {
      const pieces: unknown[][] = [];
      for (const n of field.parts) pieces.push((await decodePart(doc, n)) as unknown[]);
      value = pieces.flat();
    } else {
      const n = field.part as number;
      if (!headers.has(n)) headers.set(n, (await decodePart(doc, n)) as Table);
      value = (headers.get(n) as Table)[field.key];
    }
    // defineProperty: a field named __proto__ stays an own field.
    Object.defineProperty(file, field.key, { value, enumerable: true, writable: true, configurable: true });
  }
  return file;
}

function readIndex(doc: PartDocument): Table | undefined {
  const text = doc.getElementById(INDEX_ID)?.textContent;
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isTable(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The page's own store: the index answers the `has*` calls; a part is decoded on the first read that needs it and kept. */
function partStore(doc: PartDocument, index: Table): Store {
  const files = own(index, "files");
  const entryOf = (name: string): IndexEntry | undefined => own(files, name) as IndexEntry | undefined;
  const sourceParts = (): Table | undefined => {
    const entry = own(files, "sources");
    return isTable(entry) ? (own(entry, "paths") as Table | undefined) : undefined;
  };
  const fileCache = new Map<string, Promise<unknown>>();
  const sourcePartCache = new Map<number, Promise<unknown>>();

  return {
    hasFile: (name) => entryOf(name) !== undefined,
    readFile(name) {
      const entry = entryOf(name);
      if (entry === undefined) return Promise.resolve(undefined);
      let read = fileCache.get(name);
      if (!read) {
        read = assembleFile(doc, entry);
        fileCache.set(name, read);
      }
      return read;
    },
    hasSource: (path) => typeof own(sourceParts(), path) === "number",
    async readSource(path) {
      const n = own(sourceParts(), path);
      if (typeof n !== "number") return undefined;
      let read = sourcePartCache.get(n);
      if (!read) {
        read = decodePart(doc, n);
        sourcePartCache.set(n, read);
      }
      return own(await read, path);
    },
  };
}

const stores = new WeakMap<object, Store | null>();

/** The store of the page: the index and parts of the document. */
function pageStore(): Store | undefined {
  if (typeof document === "undefined") return undefined;
  const doc = document as unknown as PartDocument;
  let store = stores.get(doc);
  if (store === undefined) {
    const index = readIndex(doc);
    store = index ? partStore(doc, index) : null;
    stores.set(doc, store);
  }
  return store ?? undefined;
}

function storeOf(data: unknown): Store | undefined {
  return data === undefined ? pageStore() : plainStore(data);
}

export function hasInlineFile(name: InlineDataFile, data?: unknown): boolean {
  return storeOf(data)?.hasFile(name) ?? false;
}

export async function readInlineFile(name: InlineDataFile, data?: unknown): Promise<InlineResponse> {
  const store = storeOf(data);
  if (!store || !store.hasFile(name)) return notFound(`${name} is not included in this page`);
  try {
    const value = await store.readFile(name);
    return value === undefined || value === null ? notFound(`${name} is not included in this page`) : found(value);
  } catch (error) {
    return unreadable(`${name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readInlineSource(filePath: string, data?: unknown): Promise<InlineResponse> {
  const store = storeOf(data);
  if (!store || !store.hasSource(filePath)) return notFound("Source is not included in this page");
  try {
    const value = await store.readSource(filePath);
    return value === undefined || value === null ? notFound("Source is not included in this page") : found(value);
  } catch (error) {
    return unreadable(`Source could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** True when the page holds the source of this path (it was packed with source, and the file is in it). Reads the index only. */
export function hasInlineSource(filePath: string, data?: unknown): boolean {
  return storeOf(data)?.hasSource(filePath) ?? false;
}

/** `fetch` for the data files, for the freshness request that takes a fetcher. */
export const inlineFetch: typeof fetch = (input) =>
  readInlineFile(String(input) as InlineDataFile) as Promise<Response>;
