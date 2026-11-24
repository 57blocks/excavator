/**
 * feature-groups.mjs
 *
 * The feature groups the explorer page's Domain view opens between a domain and its flows, so the canvas
 * never draws every flow of a large domain at once. Deterministic and model-free; the packer writes the
 * result as the page's `feature-groups.json`, and `translation-names.mjs` takes `shownNames(result)` as names
 * to translate, so the page and the translation counts read the same groups.
 *
 * Inputs: the domain graph, and when the page has them the relations graph (its linked http relations) and
 * the knowledge graph (its `imports` edges between files). Without them the client rules give nothing and
 * the other rules still group every flow.
 *
 * Every flow of a domain (a `contains_flow` edge from the domain) lands in exactly one group, by the first
 * rule that applies, evaluated per domain (a flow two domains contain is grouped in each):
 *
 *   1 client       A backend flow (entry type http, module outside every front-end unit) whose matching linked
 *                  http relations have exactly one caller file, when that file's home domain is this domain.
 *                  A relation matches a flow when its method and normalised path equal one of the flow's entry
 *                  routes, or its receiver node is one of the flow's step nodes. A file's home domain is the
 *                  domain holding at least 60% of the backend flows its relations match; a file has none
 *                  otherwise.
 *   2 page client  A front-end flow (module inside a front-end unit: a unit that calls over http and is never
 *                  called) when exactly one caller file whose home domain is this domain is a step file of the
 *                  flow or is imported directly by one.
 *   3 route        The flow's entry route (`METHOD /path` or a bare `/path`, the first of a list): its first
 *                  segment after versions, `api`, parameters and wildcards, and after leading scope segments,
 *                  by its word key. A scope is a first segment that leads routes in at least a third of the
 *                  domains that have routes (at least 2 of them, and only when at least 3 domains have routes);
 *                  the skipped scopes stay on the flow as its `scope` tag. A route that is all scope keeps its
 *                  last scope; a route with nothing left is "/".
 *   4 entry        The entry type when it is not http (cron, cli, event, manual, ...): one group per type.
 *   5 directory    The last directory of the flow's module, by its word key (so it joins the route group of the
 *                  same word).
 *   none           A flow with none of these: the group "Flows without a route or module", visible like the rest.
 *
 * Word key: lower case, `-` and `_` removed, a trailing `service` or `api` dropped (when something remains),
 * then a trailing plural `s` dropped (not `ss`, `us` or `is`).
 *
 * Labels: a route or directory group shows its word in the spelling the data gives it, split into words when
 * one of its spellings in the data is split (`work-logs`, `workLogs`); a client group shows the route word of
 * its members when that word covers at least half of them, otherwise the caller file's base name without its
 * extension, split the same way. A client group also names its caller file.
 *
 * A domain that would show more than MAX_GROUPS groups folds its single-flow groups into one group "Other",
 * listed last; each moved flow keeps its former label as `origin`. Groups are ordered: client and word
 * groups by label, entry types, the no-route-no-module group, then "Other"; flows keep the domain graph's
 * order inside a group. Each flow records the rule that placed it.
 */

export const FEATURE_GROUPS_KEY = 'feature-groups.json';
export const FEATURE_GROUPS_FORMAT = 'excavator-view-feature-groups/3';

export const MAX_GROUPS = 12;
export const HOME_SHARE = 0.6;
export const ROOT_LABEL = '/';
export const NO_ROUTE_LABEL = 'Flows without a route or module';
export const OTHER_LABEL = 'Other';
export const ENTRY_LABELS = { cron: 'Scheduled jobs', cli: 'CLI commands', event: 'Events', manual: 'Manual entries' };

const KIND_ORDER = ['feature', 'entry', 'none', 'other'];
const HTTP_METHOD = /^([A-Za-z]+)\s+(\S+)/;
const VERSION = /^v\d+(?:\.\d+)*$/i;
const PARAMETER = /^(?::|\{|<|\*)/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const list = (value) => (Array.isArray(value) ? value : []);
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fileOfId = (id) => (typeof id === 'string' && id.startsWith('file:') ? id.slice(5) : null);

/** The word key two names are compared by. */
export function wordKey(name) {
  let key = name.toLowerCase().replace(/[-_]/g, '');
  for (const suffix of ['service', 'api']) if (key.length > suffix.length && key.endsWith(suffix)) key = key.slice(0, -suffix.length);
  return key.length > 3 && key.endsWith('s') && !/(?:ss|us|is)$/.test(key) ? key.slice(0, -1) : key;
}

/** A name split into lower-case words at `-`, `_`, `.` and lower-to-upper case changes. */
export const splitWords = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_.\s]+/)
    .filter((part) => part !== '')
    .map((part) => part.toLowerCase());

/** The routes an entry point names: [{ method|null, segments }] with raw segments (parameters kept), or []. */
export function entryRoutes(entryPoint) {
  const routes = [];
  for (const part of (text(entryPoint) ?? '').split(',')) {
    const item = part.trim();
    const match = HTTP_METHOD.exec(item);
    const path = match ? match[2] : item.startsWith('/') ? item : null;
    if (path === null || !path.startsWith('/')) continue;
    routes.push({ method: match ? match[1].toUpperCase() : null, segments: path.split(/[?#]/)[0].split('/').filter((s) => s !== '') });
  }
  return routes;
}

/** The segments of a route that can name a feature: no versions, `api`, parameters or wildcards. */
export const featureSegments = (segments) => segments.filter((part) => !VERSION.test(part) && !PARAMETER.test(part) && part.toLowerCase() !== 'api');

/** The key a route is matched to a relation address by: `METHOD /a/{}/b`, lower-case path, parameters as `{}`. */
export const addressKey = (method, segments) => `${(method ?? '').toUpperCase()} /${segments.map((s) => (PARAMETER.test(s) ? '{}' : s.toLowerCase())).join('/')}`;

const metaOf = (flow) => (isObject(flow?.domainMeta) ? flow.domainMeta : {});

function scopeKeys(domainFlows) {
  const domainsByKey = new Map();
  let withRoutes = 0;
  for (const flows of domainFlows.values()) {
    const firsts = new Set();
    for (const flow of flows) {
      const route = entryRoutes(metaOf(flow).entryPoint)[0];
      if (route === undefined) continue;
      const segments = featureSegments(route.segments);
      firsts.add(segments.length > 0 ? wordKey(segments[0]) : null);
    }
    if (firsts.size === 0) continue;
    withRoutes += 1;
    for (const key of firsts) if (key !== null) domainsByKey.set(key, (domainsByKey.get(key) ?? 0) + 1);
  }
  const scopes = new Set();
  if (withRoutes < 3) return scopes;
  const needed = Math.max(2, Math.ceil(withRoutes / 3));
  for (const [key, count] of domainsByKey) if (count >= needed) scopes.add(key);
  return scopes;
}

/** The route word of a flow: { key, spelled, scope } or null when the entry names no route. */
function routeWord(flow, scopes) {
  const route = entryRoutes(metaOf(flow).entryPoint)[0];
  if (route === undefined) return null;
  const segments = featureSegments(route.segments);
  if (segments.length === 0) return { key: ROOT_LABEL, spelled: ROOT_LABEL, scope: null };
  let index = 0;
  while (index < segments.length - 1 && scopes.has(wordKey(segments[index]))) index += 1;
  return { key: wordKey(segments[index]), spelled: segments[index], scope: index > 0 ? segments.slice(0, index).map((s) => s.toLowerCase()).join('/') : null };
}

/** The units that call over http and are never called: the front ends. */
function frontEndRoots(relations) {
  const callers = new Set();
  const receivers = new Set();
  for (const relation of list(relations?.relations)) {
    if (relation?.kind !== 'http') continue;
    if (typeof relation.caller?.unit === 'string') callers.add(relation.caller.unit);
    if (typeof relation.receiver?.unit === 'string') receivers.add(relation.receiver.unit);
  }
  return list(relations?.units)
    .filter((unit) => callers.has(unit?.id) && !receivers.has(unit?.id) && typeof unit.root === 'string' && unit.root !== '.' && unit.root !== '')
    .map((unit) => unit.root.replace(/\/+$/, ''));
}

const insideAny = (path, roots) => typeof path === 'string' && roots.some((root) => path === root || path.startsWith(`${root}/`));

/** The display of a word key: the most frequent split spelling the data gives it, else the most frequent spelling. */
function displayOf(spellings) {
  const counts = new Map();
  for (const spelled of spellings) {
    const words = splitWords(spelled).join(' ');
    if (words !== '') counts.set(words, (counts.get(words) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => Number(b[0].includes(' ')) - Number(a[0].includes(' ')) || b[1] - a[1] || a[0].length - b[0].length || compareText(a[0], b[0]));
  return ranked.length > 0 ? ranked[0][0] : null;
}

export const QUALIFIER_SEPARATOR = ' \u00b7 ';

/** The name a group is shown by: its label, then the qualifier of a client group whose label another group of the domain shares. */
export const groupTitle = (group) => (group.qualifier == null ? group.label : `${group.label}${QUALIFIER_SEPARATOR}${group.qualifier}`);

const compareGroups = (a, b) =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compareText(a.label, b.label) || compareText(groupTitle(a), groupTitle(b)) || compareText(a.id, b.id);

const stripExtension = (path) => path.replace(/\.[^./]+$/, '');

/**
 * Sets `qualifier` on the client groups of a domain whose label another group shares (compared case-insensitively):
 * the shortest suffix of the caller file path, without its extension, that no other client group of the set has.
 * Files that differ only by extension keep it. Word groups keep the bare label; entry, none and other groups have
 * fixed distinct labels. Returns new group objects.
 */
function qualifyGroups(groups) {
  const byLabel = new Map();
  for (const group of groups) byLabel.set(group.label.toLowerCase(), [...(byLabel.get(group.label.toLowerCase()) ?? []), group]);
  const qualifiers = new Map();
  for (const set of byLabel.values()) {
    if (set.length < 2) continue;
    const clients = set.filter((group) => group.file !== null);
    const stripped = clients.map((group) => stripExtension(group.file));
    const segments = clients.map((group, index) => (stripped.filter((other) => other === stripped[index]).length > 1 ? group.file : stripped[index]).split('/'));
    clients.forEach((group, index) => {
      const mine = segments[index];
      let k = 1;
      while (k < mine.length && segments.some((other, i) => i !== index && other.length >= k && other.slice(-k).join('/') === mine.slice(-k).join('/'))) k += 1;
      qualifiers.set(group.id, mine.slice(-k).join('/'));
    });
  }
  return groups.map((group) => ({ ...group, qualifier: qualifiers.get(group.id) ?? null }));
}

/**
 * The groups of every domain:
 * { format, domains: { <domain id>: [{ id, kind, label, file, flows: [{ id, rule, scope, origin }] }] } }.
 * `kind` is feature | entry | none | other; `file` is the caller file of a client group, else null; `qualifier` is
 * set on a client group whose label another group of the domain shares (the displayed name is `groupTitle`).
 */
export function featureGroups(domainGraph, { relations = null, knowledgeGraph = null } = {}) {
  const nodes = list(domainGraph?.nodes);
  const edges = list(domainGraph?.edges);
  const flows = new Map();
  const steps = new Map();
  nodes.forEach((node, index) => {
    if (typeof node?.id !== 'string') return;
    if (node.type === 'flow' && !flows.has(node.id)) flows.set(node.id, { node, index });
    if (node.type === 'step' && !steps.has(node.id)) steps.set(node.id, node);
  });
  const domainIds = [];
  for (const node of nodes) if (node?.type === 'domain' && typeof node.id === 'string' && !domainIds.includes(node.id)) domainIds.push(node.id);
  const flowIdsOf = new Map();
  const stepsOf = new Map();
  for (const edge of edges) {
    if (edge?.type === 'contains_flow' && flows.has(edge.target)) {
      const set = flowIdsOf.get(edge.source) ?? new Set();
      set.add(edge.target);
      flowIdsOf.set(edge.source, set);
    }
    if (edge?.type === 'flow_step' && flows.has(edge.source) && steps.has(edge.target)) {
      const set = stepsOf.get(edge.source) ?? new Set();
      set.add(steps.get(edge.target));
      stepsOf.set(edge.source, set);
    }
  }
  const domainFlows = new Map(domainIds.map((id) => [id, [...(flowIdsOf.get(id) ?? [])].sort((a, b) => flows.get(a).index - flows.get(b).index).map((flowId) => flows.get(flowId).node)]));
  const domainsOfFlow = new Map();
  for (const [domainId, list_] of domainFlows) for (const flow of list_) domainsOfFlow.set(flow.id, [...(domainsOfFlow.get(flow.id) ?? []), domainId]);
  const scopes = scopeKeys(domainFlows);

  // Rule 1 and 2 inputs: which caller files reach which backend flows, and each file's home domain.
  const frontEnds = frontEndRoots(relations);
  const isFrontEnd = (flow) => insideAny(text(metaOf(flow).module), frontEnds);
  const backend = [...flows.values()].map((entry) => entry.node).filter((flow) => text(metaOf(flow).entryType) === 'http' && !isFrontEnd(flow));
  const byAddress = new Map();
  const byNode = new Map();
  const add = (map, key, value) => map.set(key, (map.get(key) ?? new Set()).add(value));
  for (const flow of backend) {
    for (const route of entryRoutes(metaOf(flow).entryPoint)) if (route.method !== null) add(byAddress, addressKey(route.method, route.segments), flow.id);
    for (const step of stepsOf.get(flow.id) ?? []) for (const nodeId of list(step.nodeIds)) if (typeof nodeId === 'string') add(byNode, nodeId, flow.id);
  }
  const callersOfFlow = new Map();
  const flowsOfFile = new Map();
  for (const relation of list(relations?.relations)) {
    if (relation?.kind !== 'http' || relation.bucket !== 'linked') continue;
    const file = text(relation.caller?.file);
    if (file === null) continue;
    const method = text(relation.address?.method);
    const path = text(relation.address?.path);
    const matched = new Set([
      ...(method !== null && path !== null ? (byAddress.get(addressKey(method, path.split(/[?#]/)[0].split('/').filter((s) => s !== ''))) ?? []) : []),
      ...(byNode.get(relation.receiver?.nodeId) ?? []),
    ]);
    for (const flowId of matched) {
      add(callersOfFlow, flowId, file);
      add(flowsOfFile, file, flowId);
    }
  }
  const homeOf = new Map();
  for (const [file, reached] of flowsOfFile) {
    const perDomain = new Map();
    for (const flowId of reached) for (const domainId of domainsOfFlow.get(flowId) ?? []) perDomain.set(domainId, (perDomain.get(domainId) ?? 0) + 1);
    const best = [...perDomain].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))[0];
    if (best !== undefined && best[1] / reached.size >= HOME_SHARE) homeOf.set(file, best[0]);
  }
  const importsOf = new Map();
  for (const edge of list(knowledgeGraph?.edges)) {
    if (edge?.type !== 'imports') continue;
    const from = fileOfId(edge.source);
    const to = fileOfId(edge.target);
    if (from !== null && to !== null) add(importsOf, from, to);
  }

  const spellings = new Map();
  const spell = (key, spelled) => spellings.set(key, [...(spellings.get(key) ?? []), spelled]);

  const domains = {};
  for (const domainId of domainIds) {
    const held = new Map();
    const place = (group, flow, rule, scope) => {
      const entry = held.get(group.id) ?? { ...group, flows: [] };
      entry.flows.push({ id: flow.id, rule, scope, origin: null });
      held.set(group.id, entry);
    };
    for (const flow of domainFlows.get(domainId)) {
      const meta = metaOf(flow);
      const word = routeWord(flow, scopes);
      const scope = word?.scope ?? null;
      if (word !== null) spell(word.key, word.spelled);
      const callers = [...(callersOfFlow.get(flow.id) ?? [])];
      if (!isFrontEnd(flow) && text(meta.entryType) === 'http' && callers.length === 1 && homeOf.get(callers[0]) === domainId) {
        place({ id: `client:${callers[0]}`, kind: 'feature', label: null, file: callers[0] }, flow, 'client', scope);
        continue;
      }
      if (isFrontEnd(flow)) {
        const near = new Set();
        for (const step of stepsOf.get(flow.id) ?? []) {
          const file = text(step.filePath);
          if (file === null) continue;
          near.add(file);
          for (const imported of importsOf.get(file) ?? []) near.add(imported);
        }
        const candidates = [...near].filter((file) => homeOf.get(file) === domainId);
        if (candidates.length === 1) {
          place({ id: `client:${candidates[0]}`, kind: 'feature', label: null, file: candidates[0] }, flow, 'page-client', scope);
          continue;
        }
      }
      if (word !== null) {
        place({ id: `word:${word.key}`, kind: 'feature', label: null, file: null, key: word.key }, flow, 'route', scope);
        continue;
      }
      const entryType = text(meta.entryType);
      if (entryType !== null && entryType !== 'http') {
        place({ id: `entry:${entryType}`, kind: 'entry', label: ENTRY_LABELS[entryType] ?? entryType, file: null }, flow, 'entry', null);
        continue;
      }
      const directory = text(meta.module)?.split('/').filter((part) => part !== '').pop() ?? null;
      if (directory !== null) {
        spell(wordKey(directory), directory);
        place({ id: `word:${wordKey(directory)}`, kind: 'feature', label: null, file: null, key: wordKey(directory) }, flow, 'directory', null);
        continue;
      }
      place({ id: 'none', kind: 'none', label: NO_ROUTE_LABEL, file: null }, flow, 'none', null);
    }
    domains[domainId] = [...held.values()];
  }

  const flowById = (id) => flows.get(id).node;
  for (const domainId of domainIds) {
    let groups = domains[domainId].map(({ key, ...group }) => {
      if (group.label !== null) return group;
      if (key !== undefined) return { ...group, label: key === ROOT_LABEL ? ROOT_LABEL : displayOf(spellings.get(key) ?? []) ?? key };
      const words = new Map();
      for (const member of group.flows) {
        const word = routeWord(flowById(member.id), scopes);
        if (word !== null) words.set(word.key, (words.get(word.key) ?? 0) + 1);
      }
      const top = [...words].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))[0];
      if (top !== undefined && top[1] * 2 >= group.flows.length) return { ...group, label: top[0] === ROOT_LABEL ? ROOT_LABEL : displayOf(spellings.get(top[0]) ?? []) ?? top[0] };
      const base = group.file.split('/').pop().replace(/\.[^.]+$/, '');
      return { ...group, label: splitWords(base).join(' ') || base };
    });
    groups = qualifyGroups(groups);
    if (groups.length > MAX_GROUPS) {
      const single = groups.filter((group) => group.flows.length === 1);
      if (single.length > 1) {
        const moved = single.sort(compareGroups).map((group) => ({ ...group.flows[0], origin: groupTitle(group) }));
        groups = [...groups.filter((group) => group.flows.length !== 1), { id: 'other', kind: 'other', label: OTHER_LABEL, qualifier: null, file: null, flows: moved }];
      }
    }
    domains[domainId] = groups.sort(compareGroups);
  }
  return { format: FEATURE_GROUPS_FORMAT, domains };
}

/** Every name the page shows for the groups, once each: group labels, scope tags and the former labels of moved flows (label part only). */
export function shownNames(result) {
  const names = new Set();
  for (const groups of Object.values(isObject(result?.domains) ? result.domains : {})) {
    for (const group of list(groups)) {
      const label = text(group?.label);
      if (label !== null) names.add(label);
      for (const flow of list(group?.flows)) {
        // A former label with a qualifier carries a file path, which is not translated: only its label part is a name.
        const origin = text(flow?.origin);
        for (const name of [text(flow?.scope), origin === null ? null : origin.split(QUALIFIER_SEPARATOR)[0]]) if (name !== null && name !== '') names.add(name);
      }
    }
  }
  return [...names];
}
