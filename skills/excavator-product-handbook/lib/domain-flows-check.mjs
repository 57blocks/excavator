/**
 * The domain flow diagrams (openspec change handbook-free-chapter, D8): the file
 * `<out>/domain-flows.json` the orchestrator writes, checked node by node and
 * edge by edge against what goes into the handbook (the map's domains, the entries
 * `loadCheckedRun` loads and the chapters of the checked /3 entries). Nothing in a
 * diagram can come from outside those: a node is a feature, a state of a fact sheet
 * or entry, or a verbatim fragment of one chapter item; an edge is a hand-over, a
 * transition, the order of two items of one chapter, or a state label inside an item.
 * Pure apart from reading the file; no model, no clock.
 *
 * Every problem is one line naming the domain and the node or edge; any problem refuses
 * the whole file. `models` (domain id -> `{ nodes, edges }`, with the label each node is
 * drawn with) is what handbook.md and the page draw from.
 */

import { join } from 'node:path';

import { transitionList } from './entry-parts.mjs';
import { isObject, readJson } from './json-file.mjs';

export const DOMAIN_FLOWS_FILE = 'domain-flows.json';
export const DOMAIN_FLOWS_FORMAT = 'excavator-product-handbook-domain-flows/1';
/** The most code points of a node fragment and of an edge text. */
export const NODE_TEXT_MAX = 24;
export const EDGE_TEXT_MAX = 12;

const points = (text) => [...text].length;
const quoted = (text) => JSON.stringify(text);
const nonEmpty = (value) => typeof value === 'string' && value !== '';

/** The hand-overs of an entry: a /2 entry keeps them in its operations, a /3 fact sheet at the top level. */
const handoffsOf = (entry) => [...(entry?.operations ?? []).flatMap((operation) => operation.handoffs ?? []), ...(entry?.handoffs ?? [])];

/** The shape problems of the file (lines); anything else cannot be read from a malformed file. */
function shapeProblems(doc) {
  const problems = [];
  if (!isObject(doc)) return [`${DOMAIN_FLOWS_FILE}: must be a JSON object`];
  if (doc.format !== DOMAIN_FLOWS_FORMAT) problems.push(`format: must be ${DOMAIN_FLOWS_FORMAT}`);
  if (!Array.isArray(doc.domains)) return [...problems, 'domains: must be a list'];
  doc.domains.forEach((domain, at) => {
    const where = `domains[${at}]`;
    if (!isObject(domain) || !nonEmpty(domain.domain)) return problems.push(`${where}: must be an object with a domain id`);
    if (!Array.isArray(domain.nodes)) problems.push(`${where}: nodes must be a list`);
    if (!Array.isArray(domain.edges)) problems.push(`${where}: edges must be a list`);
    (Array.isArray(domain.nodes) ? domain.nodes : []).forEach((node, index) => {
      const at2 = `${where}.nodes[${index}]`;
      if (!isObject(node) || !nonEmpty(node.id)) return problems.push(`${at2}: must be an object with an id`);
      const kinds = ['feature', 'state', 'item'].filter((key) => node[key] !== undefined);
      if (kinds.length !== 1) return problems.push(`${at2}: must have exactly one of feature, state and item`);
      const [kind] = kinds;
      if (kind === 'feature' && !nonEmpty(node.feature)) problems.push(`${at2}: feature must be a feature id`);
      if (kind === 'state' && !(isObject(node.state) && nonEmpty(node.state.feature) && nonEmpty(node.state.label))) problems.push(`${at2}: state must be { feature, label }`);
      if (kind === 'item' && !(isObject(node.item) && nonEmpty(node.item.feature) && nonEmpty(node.item.item) && typeof node.text === 'string')) problems.push(`${at2}: item must be { feature, item } with a text`);
    });
    (Array.isArray(domain.edges) ? domain.edges : []).forEach((edge, index) => {
      if (!isObject(edge) || !nonEmpty(edge.from) || !nonEmpty(edge.to) || (edge.text !== undefined && typeof edge.text !== 'string')) problems.push(`${where}.edges[${index}]: must be { from, to } with an optional text`);
    });
  });
  return problems;
}

/** The node as the checks read it, or null when it has a problem (pushed to `problems`). */
function readNode(node, { domain, owns, entries, chapters, nameOf, problems }) {
  const say = (reason) => { problems.push(`domain ${domain} node ${node.id}: ${reason}`); };
  const feature = node.state?.feature ?? node.item?.feature ?? node.feature;
  if (!owns.has(feature)) return say(`feature ${feature} is not in domain ${domain}`) ?? null;
  if (!entries.has(feature)) return say(`feature ${feature} has no entry in the handbook`) ?? null;
  if (node.state !== undefined) {
    const entry = entries.get(feature);
    if (!(entry.states ?? []).some((state) => state.label === node.state.label)) return say(`state label ${quoted(node.state.label)} is not a state of ${feature}`) ?? null;
    return { id: node.id, kind: 'state', feature, label: node.state.label };
  }
  if (node.item !== undefined) {
    const chapter = chapters.get(feature);
    if (chapter === undefined) return say(`feature ${feature} has no chapter in the handbook; only a checked /3 entry has one`) ?? null;
    const item = chapter.items.find((one) => one.id === node.item.item);
    if (item === undefined) return say(`${node.item.item} is not an item of ${feature}`) ?? null;
    const length = points(node.text);
    if (length < 1 || length > NODE_TEXT_MAX) return say(`the text must be 1 to ${NODE_TEXT_MAX} characters, it has ${length}`) ?? null;
    if (!item.own.includes(node.text)) return say(`the text ${quoted(node.text)} does not occur in ${item.id} of ${feature}`) ?? null;
    return { id: node.id, kind: 'item', feature, label: node.text, item: item.id, own: item.own, number: Number(/\d+$/.exec(item.id)?.[0] ?? 0) };
  }
  return { id: node.id, kind: 'feature', feature, label: nameOf.get(feature) ?? feature };
}

/**
 * The texts an edge text may come from, or the reason the two nodes cannot be joined. Returns `{ sources }` (strings) or `{ reason }`.
 */
function edgeSources(from, to, entries) {
  const kinds = `${from.kind} ${to.kind}`;
  if (kinds === 'feature feature') {
    const sources = handoffsOf(entries.get(from.feature)).filter((handoff) => handoff.feature === to.feature).map((handoff) => handoff.text);
    return sources.length === 0 ? { reason: `no hand-over from ${from.feature} to ${to.feature}` } : { sources };
  }
  if (kinds === 'state state') {
    if (from.feature !== to.feature) return { reason: 'two states of different features have no transition between them' };
    const sources = transitionList(entries.get(from.feature)).filter((item) => item.from === from.label && item.to === to.label).map((item) => item.by);
    return sources.length === 0 ? { reason: `no transition from ${quoted(from.label)} to ${quoted(to.label)} in ${from.feature}` } : { sources };
  }
  if (kinds === 'item item') {
    if (from.feature !== to.feature) return { reason: 'two items of different features have no order' };
    if (from.item === to.item) return { reason: `both nodes are the item ${from.item}` };
    if (from.number > to.number) return { reason: `${from.item} comes later in the chapter than ${to.item}; an edge runs from the earlier item to the later one` };
    return { sources: [from.own, to.own] };
  }
  if ((from.kind === 'item' && to.kind === 'state') || (from.kind === 'state' && to.kind === 'item')) {
    const [item, state] = from.kind === 'item' ? [from, to] : [to, from];
    if (!item.own.includes(state.label)) return { reason: `the state label ${quoted(state.label)} does not occur in ${item.item}` };
    return { sources: [item.own] };
  }
  return { reason: `no kind of edge joins a ${from.kind} node and a ${to.kind} node; an edge joins two features, two states, two items, or an item and a state` };
}

/**
 * All problems of a domain flows document.
 * `ctx`: `map`, `domains` (a domains.json that passed check-domains, or null), `entries` (id -> entry that goes into the handbook) and `chapters` (id -> `{ items }` of each checked /3 entry, each item with `own`).
 * Returns `{ problems, counts: { domains, nodes, edges }, models }`.
 */
export function domainFlowProblems(doc, { map, domains, entries, chapters }) {
  const shape = shapeProblems(doc);
  if (shape.length > 0) return { problems: shape, counts: { domains: 0, nodes: 0, edges: 0 }, models: new Map() };
  const problems = [];
  const models = new Map();
  const counts = { domains: doc.domains.length, nodes: 0, edges: 0 };
  const nameOf = new Map(map.features.map((feature) => [feature.id, feature.name]));
  const known = new Map((domains?.domains ?? []).map((domain) => [domain.id, new Set(domain.features)]));
  if (domains === null || domains === undefined) problems.push(`domains.json is missing or does not pass check-domains; no domain flow can be checked`);
  for (const flow of doc.domains) {
    const domain = flow.domain;
    if (models.has(domain)) {
      problems.push(`domain ${domain}: listed more than once`);
      continue;
    }
    if (!known.has(domain)) {
      if (domains !== null && domains !== undefined) problems.push(`domain ${domain}: not a domain of domains.json`);
      continue;
    }
    counts.nodes += flow.nodes.length;
    counts.edges += flow.edges.length;
    const before = problems.length;
    if (flow.nodes.length === 0) problems.push(`domain ${domain}: has no nodes; leave the domain out instead`);
    const nodes = new Map();
    const duplicates = new Set();
    for (const node of flow.nodes) {
      if (nodes.has(node.id) || duplicates.has(node.id)) {
        duplicates.add(node.id);
        problems.push(`domain ${domain} node ${node.id}: the id is used more than once`);
        continue;
      }
      const read = readNode(node, { domain, owns: known.get(domain), entries, chapters, nameOf, problems });
      nodes.set(node.id, read);
    }
    for (const edge of flow.edges) {
      const say = (reason) => problems.push(`domain ${domain} edge ${edge.from} -> ${edge.to}: ${reason}`);
      const missing = [edge.from, edge.to].find((id) => !nodes.has(id));
      if (missing !== undefined) {
        say(`there is no node ${missing}`);
        continue;
      }
      const [from, to] = [nodes.get(edge.from), nodes.get(edge.to)];
      // A node that was refused is already reported; its edges say nothing more.
      if (from === null || to === null) continue;
      const joined = edgeSources(from, to, entries);
      if (joined.reason !== undefined) {
        say(joined.reason);
        continue;
      }
      if (edge.text !== undefined) {
        const length = points(edge.text);
        if (length < 1 || length > EDGE_TEXT_MAX) say(`the text must be 1 to ${EDGE_TEXT_MAX} characters, it has ${length}`);
        else if (!joined.sources.some((source) => source.includes(edge.text))) say(`the text ${quoted(edge.text)} does not occur in the text it must come from (${from.kind === 'feature' ? 'the hand-over' : from.kind === 'state' && to.kind === 'state' ? 'the transition' : 'the item'})`);
      }
    }
    if (problems.length === before) {
      models.set(domain, {
        nodes: flow.nodes.map((node) => { const read = nodes.get(node.id); return { id: read.id, kind: read.kind, feature: read.feature, label: read.label }; }),
        edges: flow.edges.map((edge) => ({ from: edge.from, to: edge.to, ...(edge.text === undefined ? {} : { text: edge.text }) })),
      });
    }
  }
  return { problems, counts, models };
}

/**
 * The state of the domain flows for a loaded run (load-run.mjs): `{ status: 'none' }` when no attempt is recorded,
 * `{ status: 'failed' }` when the last attempt failed or the file no longer passes against the entries as they are now,
 * `{ status: 'checked', models }` otherwise. Never a reason to refuse a run.
 */
export function loadDomainFlows(outDir, state, ctx) {
  const recorded = state.domainFlows;
  if (recorded === undefined) return { status: 'none' };
  if (recorded.status !== 'checked') return { status: 'failed' };
  const read = readJson(join(outDir, DOMAIN_FLOWS_FILE));
  if (!read.ok) return { status: 'failed' };
  const result = domainFlowProblems(read.value, ctx);
  return result.problems.length > 0 ? { status: 'failed' } : { status: 'checked', models: result.models };
}
