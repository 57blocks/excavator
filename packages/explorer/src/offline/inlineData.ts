// The data of the offline page. The upstream dashboard fetched six data files
// and a source file from its dev server; the offline page has no server, so
// the packing step writes them into the page as one object (openspec:
// changes/viewer-explorer, design D2):
//
//   window.__EXCAVATOR_EXPLORER_DATA__ = {
//     "knowledge-graph.json": <the knowledge graph, as the upstream file>,
//     "domain-graph.json":    <the domain graph>,
//     "meta.json":            <the meta file>,
//     "diff-overlay.json":    <the diff overlay>,
//     "config.json":          <the config>,
//     "staleness.json":       <the freshness report>,
//     "unused-code.json", "hotspots.json", "doc-map.json", "doc-map-checks.json":
//                             <the product files, when their products were packed>,
//     "products.json":        <{ products: [{ name, status, reason, revision, revisionNote, command }] }>,
//     "sources": { "<node.filePath>": { path, language, content, sizeBytes, lineCount } },
//   }
//
// The keys are the original file names. A key that is absent (or null) is a
// file the server did not have: a read answers with the 404 and the
// `{ error }` body the upstream server sent, so each caller takes the branch
// it already had for a failed request and the dashboard shows its own empty
// state. `sources` is keyed by the path a node carries in `filePath`, and a
// value has the shape the upstream `/file-content.json` answered with.

export const DATA_GLOBAL = "__EXCAVATOR_EXPLORER_DATA__";

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

function pageData(): unknown {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Table)[DATA_GLOBAL];
}

function found(value: unknown): Promise<InlineResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
}

function notFound(message: string): Promise<InlineResponse> {
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: message }) });
}

export function hasInlineFile(name: InlineDataFile, data: unknown = pageData()): boolean {
  return own(data, name) !== undefined;
}

export function readInlineFile(name: InlineDataFile, data: unknown = pageData()): Promise<InlineResponse> {
  const value = own(data, name);
  return value === undefined ? notFound(`${name} is not included in this page`) : found(value);
}

export function readInlineSource(filePath: string, data: unknown = pageData()): Promise<InlineResponse> {
  const value = own(own(data, "sources"), filePath);
  return value === undefined ? notFound("Source is not included in this page") : found(value);
}

/** `fetch` for the data files, for the freshness request that takes a fetcher. */
export const inlineFetch: typeof fetch = (input) =>
  readInlineFile(String(input) as InlineDataFile) as Promise<Response>;
