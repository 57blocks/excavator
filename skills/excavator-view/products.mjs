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
 * page holds for it; the semantics and domain-graph entries also have `counts`. The bytes of those
 * payloads are returned next to the entries, never inside them.
 */

import { join } from 'node:path';

import { KNOWLEDGE_GRAPH_FILE, KNOWLEDGE_GRAPH_FORMAT } from '../excavator/knowledge-graph-store.mjs';
import { readDomain } from './domain.mjs';
import { describeFormat, parseJsonObject, readRegularFile } from './product-files.mjs';
import { readSemantics } from './semantics.mjs';
import { readTour } from './tour.mjs';

export const NO_REVISION_NOTE = 'no revision recorded';

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

const DOMAIN_DEF = {
  name: 'domain-graph',
  label: 'Domain graph',
  file: 'domain-graph.json',
  command: '/excavator-domain',
};

const TOUR_DEF = {
  name: 'tour',
  label: 'Tour',
  file: 'tour.json',
  command: '/excavator-tour',
};

const SEMANTICS_DEF = {
  name: 'semantics',
  label: 'Semantics',
  file: 'semantic-cache.json',
  command: '/excavator --full',
};

const REPORTS = [
  { name: 'hotspots-report', label: 'Hotspots report', file: 'hotspots-report.md', payload: 'report-hotspots', command: '/excavator-hotspots' },
  { name: 'doc-map-report', label: 'Doc map report', file: 'doc-map-report.md', payload: 'report-doc-map', command: '/excavator-doc-map' },
];

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
    graphBytes: file.bytes,
    graphIdentity: { factsDigest: typeof checked.header.fields.project?.factsDigest === 'string' ? checked.header.fields.project.factsDigest : null },
  };
}

/**
 * The semantic files give one product. They record no source revision (their
 * freshness is the per-entry hash and the graph's facts digest), so an included
 * entry notes that; `counts` is what the page and the reply say about it.
 */
function readSemanticsProduct(dataDir, graph) {
  const def = SEMANTICS_DEF;
  const read = readSemantics(dataDir, graph.graphBytes ?? null);
  if (read.state === 'absent') return { entry: notRun(def), payloads: [] };
  if (read.state === 'unreadable') return { entry: unreadable(def, read.reason), payloads: [] };
  return {
    entry: { ...entry(def, { status: 'included', revisionNote: NO_REVISION_NOTE, payloads: [def.name] }), counts: read.counts },
    payloads: [{ id: def.name, bytes: read.bytes }],
  };
}

/**
 * The domain graph is a product of its own, read against the knowledge graph's facts digest and the snapshot's revision.
 * Its entry carries `counts` (what the page and the packer's result say about it) and, when the facts differ, the reason.
 */
function readDomainProduct(dataDir, graph, snapshotRevision) {
  const def = DOMAIN_DEF;
  const read = readDomain(dataDir, graph.graphIdentity ?? null, snapshotRevision);
  if (read.state === 'absent') return { entry: notRun(def), payloads: [] };
  if (read.state === 'unreadable') return { entry: unreadable(def, read.reason), payloads: [] };
  return {
    entry: { ...entry(def, { status: read.differs ? 'different-revision' : 'included', reason: read.reason, revision: read.revision, payloads: [def.name] }), counts: read.counts },
    payloads: [{ id: def.name, bytes: read.bytes }],
  };
}

/**
 * The tour is judged against the knowledge graph's facts digest only: its node ids name that fact graph, so a tour
 * from other facts is a different revision (the page shows none of its steps), and its source revision is recorded.
 * Its entry carries `counts` and `factDigests` (the tour's and the graph's), so the page can write both down.
 */
function readTourProduct(dataDir, graph) {
  const def = TOUR_DEF;
  const read = readTour(dataDir, graph.graphIdentity ?? null);
  if (read.state === 'absent') return { entry: notRun(def), payloads: [] };
  if (read.state === 'unreadable') return { entry: unreadable(def, read.reason), payloads: [] };
  const fields = read.differs
    ? { status: 'different-revision', reason: read.reason, revision: read.revision, payloads: [def.name] }
    : { status: 'included', revision: read.revision, revisionNote: `same facts as ${KNOWLEDGE_GRAPH_FILE} (factsDigest ${read.factDigests.graph})`, payloads: [def.name] };
  return {
    entry: { ...entry(def, fields), counts: read.counts, factDigests: read.factDigests },
    payloads: [{ id: def.name, bytes: read.bytes }],
  };
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
  const results = [graph, readSemanticsProduct(dataDir, graph), readDomainProduct(dataDir, graph, snapshotRevision), unused, docMap, hotspots, readTourProduct(dataDir, graph), readReports(dataDir)];
  return {
    entries: results.map((r) => r.entry),
    payloads: results.flatMap((r) => r.payloads),
  };
}
