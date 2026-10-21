/**
 * products.mjs
 *
 * Reads the products under `.excavator/` and gives each one exactly one state
 * (openspec: changes/report-viewer, design D3): included, not-run, unreadable,
 * or different-revision. Nothing here calls a model or touches the project's
 * source; the only inputs are the product files and the snapshot revision.
 *
 * A manifest entry is { name, label, status, reason, revision, revisionNote,
 * command, file, payloads } with `payloads` the ids of the data payloads the
 * page holds for it. The bytes of those payloads are returned next to the
 * entries, never inside them.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { KNOWLEDGE_GRAPH_FILE, KNOWLEDGE_GRAPH_FORMAT } from '../excavator/knowledge-graph-store.mjs';

export const NO_REVISION_NOTE = 'no revision recorded';

const MAX_FORMAT_CHARS = 80;
const SOURCE_MANIFEST_FILE = 'source-manifest.json';
const DOC_MAP_CHECKS_FILE = join('doc-map', 'checks.json');

/** The JSON products, with the top-level keys the viewer reads and where each one records its revision. */
const JSON_PRODUCTS = [
  {
    name: 'unused-code',
    label: 'Unused code',
    file: 'unused-code.json',
    format: 'excavator-unused-code/1',
    required: ['counts', 'conservation', 'residualAssumptions', 'decisions', 'unused', 'groups', 'testOnly'],
    revisionOf: (product) => product.sourceRevision,
    command: '/excavator-unused-code',
  },
  {
    name: 'doc-map',
    label: 'Doc map',
    file: 'doc-map.json',
    format: 'excavator-doc-map/1',
    required: ['docsRoot', 'code', 'counts', 'residualAssumptions', 'documents', 'units', 'coverage'],
    revisionOf: (product) => (product.code && typeof product.code === 'object' ? product.code.revision : undefined),
    command: '/excavator-doc-map',
    checks: true,
  },
  {
    name: 'hotspots',
    label: 'Hotspots',
    file: 'hotspots.json',
    format: 'excavator-hotspots/1',
    required: ['historyAvailable', 'window', 'counts', 'residualAssumptions', 'files', 'directories', 'pairs', 'groups'],
    revisionOf: (product) => product.sourceRevision,
    command: '/excavator-hotspots',
  },
];

/**
 * Products the page lists but does not read yet (the semantic files and the
 * domain graph; later changes of viewer-app read them). A missing file is not
 * run; a file that is there is shown as unreadable with that reason, so the
 * page never claims it holds something it does not show.
 */
const UNREAD_PRODUCTS = [
  { name: 'semantics', label: 'Semantics', file: 'semantic-cache.json', command: '/excavator --full' },
  { name: 'domain-graph', label: 'Domain graph', file: 'domain-graph.json', command: '/excavator-domain' },
];

const REPORTS = [
  { name: 'hotspots-report', label: 'Hotspots report', file: 'hotspots-report.md', payload: 'report-hotspots', command: '/excavator-hotspots' },
  { name: 'doc-map-report', label: 'Doc map report', file: 'doc-map-report.md', payload: 'report-doc-map', command: '/excavator-doc-map' },
];

/** { state: 'absent' } | { state: 'unreadable', reason } | { state: 'ok', bytes }. */
function readRegularFile(path, file) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { state: 'absent' };
    return { state: 'unreadable', reason: `${file} could not be inspected (${error.code ?? error.message})` };
  }
  if (!stat.isFile()) return { state: 'unreadable', reason: `${file} is not a regular file` };
  try {
    return { state: 'ok', bytes: readFileSync(path) };
  } catch (error) {
    return { state: 'unreadable', reason: `${file} could not be read (${error.code ?? error.message})` };
  }
}

function parseJsonObject(bytes, file) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { reason: `${file} is not valid UTF-8` };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { reason: `${file} is not valid JSON (${error.message})` };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { reason: `${file} is not a JSON object at the top level` };
  }
  return { value };
}

function describeFormat(format) {
  if (typeof format !== 'string') return 'none';
  return JSON.stringify(format.length > MAX_FORMAT_CHARS ? `${format.slice(0, MAX_FORMAT_CHARS)}...` : format);
}

function entry(def, fields) {
  return {
    name: def.name,
    label: def.label,
    status: fields.status,
    reason: fields.reason ?? null,
    revision: fields.revision ?? null,
    revisionNote: fields.revisionNote ?? null,
    command: def.command,
    file: def.file,
    payloads: fields.payloads ?? [],
  };
}

const notRun = (def) => entry(def, { status: 'not-run' });
const unreadable = (def, reason) => entry(def, { status: 'unreadable', reason });

/** Compare a product's recorded revision with the snapshot's; a product without one is noted, never assumed equal. */
function withRevision(def, revision, snapshotRevision, payloads) {
  if (typeof revision !== 'string' || revision === '') {
    return entry(def, { status: 'included', revisionNote: NO_REVISION_NOTE, payloads });
  }
  return entry(def, {
    status: revision === snapshotRevision ? 'included' : 'different-revision',
    revision,
    payloads,
  });
}

function readJsonProduct(dataDir, def, snapshotRevision) {
  const file = readRegularFile(join(dataDir, def.file), def.file);
  if (file.state === 'absent') return { entry: notRun(def), payloads: [] };
  if (file.state === 'unreadable') return { entry: unreadable(def, file.reason), payloads: [] };
  const parsed = parseJsonObject(file.bytes, def.file);
  if (!parsed.value) return { entry: unreadable(def, parsed.reason), payloads: [] };
  const product = parsed.value;
  if (product.format !== def.format) {
    return {
      entry: unreadable(def, `${def.file} has format ${describeFormat(product.format)}; the viewer reads ${def.format}`),
      payloads: [],
    };
  }
  const missing = def.required.filter((key) => !Object.hasOwn(product, key));
  if (missing.length > 0) {
    return { entry: unreadable(def, `${def.file} is missing the top-level key(s): ${missing.join(', ')}`), payloads: [] };
  }
  const payloads = [{ id: def.name, bytes: file.bytes }];
  if (def.checks) {
    const checks = readDocMapChecks(dataDir);
    if (checks.reason) return { entry: unreadable(def, checks.reason), payloads: [] };
    if (checks.bytes) payloads.push({ id: 'doc-map-checks', bytes: checks.bytes });
  }
  return { entry: withRevision(def, def.revisionOf(product), snapshotRevision, payloads.map((p) => p.id)), payloads };
}

/** `doc-map/checks.json` is part of the doc map: absent is fine, present but unreadable fails the whole product. */
function readDocMapChecks(dataDir) {
  const file = readRegularFile(join(dataDir, DOC_MAP_CHECKS_FILE), 'doc-map/checks.json');
  if (file.state === 'absent') return {};
  if (file.state === 'unreadable') return { reason: file.reason };
  const parsed = parseJsonObject(file.bytes, 'doc-map/checks.json');
  if (!parsed.value) return { reason: parsed.reason };
  if (!Array.isArray(parsed.value.checks)) return { reason: 'doc-map/checks.json is missing the top-level key(s): checks' };
  return { bytes: file.bytes };
}

const GRAPH_DEF = {
  name: 'knowledge-graph',
  label: 'Knowledge graph',
  file: KNOWLEDGE_GRAPH_FILE,
  command: '/excavator',
};

/** Validate the header line of a knowledge-graph JSONL file; the records after it are the page's to count. */
function checkGraphHeader(bytes) {
  const end = bytes.indexOf(0x0a);
  const line = bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf-8');
  if (line.trim() === '') return { reason: `${KNOWLEDGE_GRAPH_FILE} is empty` };
  let header;
  try {
    header = JSON.parse(line);
  } catch (error) {
    return { reason: `${KNOWLEDGE_GRAPH_FILE} line 1 is not valid JSON (${error.message})` };
  }
  if (header === null || typeof header !== 'object' || header.record !== 'header') {
    return { reason: `${KNOWLEDGE_GRAPH_FILE} line 1 is not a header record` };
  }
  if (header.format !== KNOWLEDGE_GRAPH_FORMAT) {
    return { reason: `${KNOWLEDGE_GRAPH_FILE} has format ${describeFormat(header.format)}; the viewer reads ${KNOWLEDGE_GRAPH_FORMAT}` };
  }
  const missing = ['fields', 'counts'].filter((key) => header[key] === null || typeof header[key] !== 'object');
  if (missing.length > 0) return { reason: `${KNOWLEDGE_GRAPH_FILE} header is missing the key(s): ${missing.join(', ')}` };
  return { header };
}

function readGraphProduct(dataDir, snapshotRevision) {
  const def = GRAPH_DEF;
  const file = readRegularFile(join(dataDir, def.file), def.file);
  if (file.state === 'absent') return { entry: notRun(def), payloads: [] };
  if (file.state === 'unreadable') return { entry: unreadable(def, file.reason), payloads: [] };
  const checked = checkGraphHeader(file.bytes);
  if (!checked.header) return { entry: unreadable(def, checked.reason), payloads: [] };

  const manifestFile = readRegularFile(join(dataDir, SOURCE_MANIFEST_FILE), SOURCE_MANIFEST_FILE);
  let revision;
  if (manifestFile.state === 'unreadable') return { entry: unreadable(def, manifestFile.reason), payloads: [] };
  if (manifestFile.state === 'ok') {
    const parsed = parseJsonObject(manifestFile.bytes, SOURCE_MANIFEST_FILE);
    if (!parsed.value) return { entry: unreadable(def, parsed.reason), payloads: [] };
    revision = parsed.value.sourceRevision;
  }
  return {
    entry: withRevision(def, revision, snapshotRevision, [def.name]),
    payloads: [{ id: def.name, bytes: file.bytes }],
  };
}

function readUnreadProduct(dataDir, def) {
  try {
    lstatSync(join(dataDir, def.file));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { entry: notRun(def), payloads: [] };
    return { entry: unreadable(def, `${def.file} could not be inspected (${error.code ?? error.message})`), payloads: [] };
  }
  return { entry: unreadable(def, `${def.file} is present; this version of the packer does not read it yet`), payloads: [] };
}

/** Reports are included or not run; their Markdown is not checked and records no revision. */
function readReports(dataDir) {
  const items = [];
  const payloads = [];
  for (const report of REPORTS) {
    const file = readRegularFile(join(dataDir, report.file), report.file);
    if (file.state === 'unreadable') throw new Error(file.reason);
    const included = file.state === 'ok';
    if (included) payloads.push({ id: report.payload, bytes: file.bytes });
    items.push({
      name: report.name,
      label: report.label,
      file: report.file,
      status: included ? 'included' : 'not-run',
      command: report.command,
      payload: included ? report.payload : null,
    });
  }
  const included = items.filter((item) => item.status === 'included');
  return {
    entry: {
      name: 'reports',
      label: 'Reports',
      status: included.length > 0 ? 'included' : 'not-run',
      reason: items.map((item) => `${item.file} ${item.status === 'included' ? 'included' : 'not run'}`).join('; '),
      revision: null,
      revisionNote: included.length > 0 ? NO_REVISION_NOTE : null,
      command: REPORTS.map((r) => r.command).join(', '),
      file: REPORTS.map((r) => r.file).join(', '),
      payloads: included.map((item) => item.payload),
      items,
    },
    payloads,
  };
}

/**
 * Every product's state, in the page's order, with the payload bytes to inline.
 * @returns {{ entries: object[], payloads: {id: string, bytes: Buffer}[] }}
 */
export function collectProducts(dataDir, snapshotRevision) {
  const graph = readGraphProduct(dataDir, snapshotRevision);
  const [unused, docMap, hotspots] = JSON_PRODUCTS.map((def) => readJsonProduct(dataDir, def, snapshotRevision));
  const results = [graph, ...UNREAD_PRODUCTS.map((def) => readUnreadProduct(dataDir, def)), unused, docMap, hotspots, readReports(dataDir)];
  return {
    entries: results.map((r) => r.entry),
    payloads: results.flatMap((r) => r.payloads),
  };
}
