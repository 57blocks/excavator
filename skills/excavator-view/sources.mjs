/**
 * sources.mjs
 *
 * Collects the source files the included products point at (the knowledge graph's
 * file nodes among them, so every graph node can open its code) and gives each one
 * exactly one class (openspec: changes/report-viewer, design D4). Text is read
 * through the source snapshot (HEAD for a git or multi-repo project, never the
 * working tree), so the page shows the revision it names.
 *
 * A path falls in the first class that fits:
 *   notEmbeddedOnRequest  the pack was asked not to embed source;
 *   notInSnapshot         the snapshot's file list does not have the path;
 *   binary                a NUL byte in the first 8 KiB;
 *   tooLarge              more than 1 MiB (the size is recorded);
 *   embedded              the text goes into the `sources` payload.
 * The limits decide only whether the text is embedded: a file over them stays
 * listed and counted.
 */

export const SOURCE_LIMIT_BYTES = 1024 * 1024;
export const BINARY_PROBE_BYTES = 8 * 1024;
export const SOURCE_PAYLOAD_ID = 'sources';

const BUCKETS = ['embedded', 'binary', 'tooLarge', 'notInSnapshot', 'notEmbeddedOnRequest'];

function parsePayload(payloads, id) {
  const payload = payloads.find((p) => p.id === id);
  return payload ? JSON.parse(payload.bytes.toString('utf-8')) : null;
}

const addPath = (set, value) => {
  if (typeof value === 'string' && value !== '') set.add(value);
};

/**
 * The path of every file node of the knowledge graph (`filePath` of a record of type `file`), so a graph node whose
 * file no other product names can still open its code. A line that is not JSON is skipped: the page reports it.
 */
function graphFilePaths(payloads) {
  const payload = payloads.find((p) => p.id === 'knowledge-graph');
  if (!payload) return [];
  const paths = [];
  for (const line of payload.bytes.toString('utf-8').split('\n')) {
    if (line === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.record === 'node' && record.node?.type === 'file') paths.push(record.node.filePath);
  }
  return paths;
}

/**
 * The paths the included products name: the graph's file nodes; unused-code `unused[].file` and `testOnly[].file`; doc-map
 * `units[].code.evidence[].file`, `coverage.files[].path` and `coverage.outside[].file`; hotspots `files[].path`
 * and `pairs[].a` / `.b`. Sorted, each once.
 */
export function referencedPaths(payloads) {
  const paths = new Set();
  for (const path of graphFilePaths(payloads)) addPath(paths, path);
  const unused = parsePayload(payloads, 'unused-code');
  if (unused) {
    for (const row of [...(unused.unused ?? []), ...(unused.testOnly ?? [])]) addPath(paths, row?.file);
  }
  const docMap = parsePayload(payloads, 'doc-map');
  if (docMap) {
    for (const unit of docMap.units ?? []) {
      for (const item of unit?.code?.evidence ?? []) addPath(paths, item?.file);
    }
    for (const row of docMap.coverage?.files ?? []) addPath(paths, row?.path);
    for (const row of docMap.coverage?.outside ?? []) addPath(paths, row?.file);
  }
  const hotspots = parsePayload(payloads, 'hotspots');
  if (hotspots) {
    for (const row of hotspots.files ?? []) addPath(paths, row?.path);
    for (const row of hotspots.pairs ?? []) {
      addPath(paths, row?.a);
      addPath(paths, row?.b);
    }
  }
  return [...paths].sort();
}

/** The class of one file and, for the classes that read it, its size and text. */
function classify(bytes) {
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return { bucket: 'binary', bytes: bytes.length };
  if (bytes.length > SOURCE_LIMIT_BYTES) return { bucket: 'tooLarge', bytes: bytes.length };
  return { bucket: 'embedded', bytes: bytes.length, text: bytes.toString('utf-8') };
}

/**
 * @param {{ noSource: boolean, snapshot: { listFiles(): string[], readFile(path: string): Buffer }, payloads: {id: string, bytes: Buffer}[] }} input
 * @returns {{ manifest: object, payloads: {id: string, bytes: Buffer}[] }}
 */
export function collectSources({ noSource, snapshot, payloads }) {
  const referenced = referencedPaths(payloads);
  const listed = noSource ? new Set() : new Set(snapshot.listFiles());
  const counts = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
  // Null-prototype maps: a file named __proto__ is an entry like any other.
  const files = Object.create(null);
  const texts = Object.create(null);
  for (const path of referenced) {
    let row;
    if (noSource) row = { bucket: 'notEmbeddedOnRequest' };
    else if (!listed.has(path)) row = { bucket: 'notInSnapshot' };
    else {
      const { text, ...rest } = classify(snapshot.readFile(path));
      row = rest;
      if (text !== undefined) texts[path] = text;
    }
    counts[row.bucket] += 1;
    files[path] = row;
  }
  const embedded = counts.embedded > 0;
  return {
    manifest: { embedded, requested: !noSource, limitBytes: SOURCE_LIMIT_BYTES, counts, files },
    payloads: embedded ? [{ id: SOURCE_PAYLOAD_ID, bytes: Buffer.from(JSON.stringify(texts), 'utf-8') }] : [],
  };
}

/** The manifest's source section without the per-file rows, for the pack's result line. */
export function summarizeSources(manifest) {
  const { files, ...summary } = manifest;
  return summary;
}
