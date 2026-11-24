/**
 * relations-address.mjs
 *
 * Normalized addresses and the fixed matching rules of the relations skill.
 * Pure functions, no I/O, no framework names.
 *
 *   http      method upper-cased (ANY and ALL match every method); the path
 *             loses scheme and host (kept as `host`), query and fragment,
 *             repeated and trailing slashes; `:x`, `{x}`, `<x>`, `${...}`,
 *             `[x]` and any segment holding one of them become a parameter
 *             `{}`; `*`, `**`, `*x`, `[...x]` become a wildcard `{*}` that
 *             eats every following segment. Key: `METHOD /a/{}/b`.
 *   rpc       service name after its last `.`, then the method: `Service/Method`.
 *   message   channel, realtime event: trimmed, placeholders written `{}`.
 *   external  `external:<id>`, never the analyzer's free-form name
 *             (externalIdentity): a host's organization label, else the name
 *             looked up in the fixed table external-services.json; a library
 *             or protocol name is unresolved; any other name is its own id,
 *             marked `keyBy: 'name'`. The name and host stay as labels.
 * An address with no literal part (a path that is only a variable) is
 * unresolved, as is one the analyzer marked `unresolved`.
 */

import EXTERNAL_SERVICES from './external-services.json' with { type: 'json' };

export const KINDS = Object.freeze(['http', 'rpc', 'message', 'realtime', 'external']);
const ANY_METHODS = new Set(['ANY', 'ALL', '*']);
const PLACEHOLDER = /\$\{[^}]*\}|\{[^}]*\}|<[^>]*>/g;
/** A character no path holds, marking a protected template expression. */
const HOLD = String.fromCharCode(1);
const HELD = new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g');
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

function segmentOf(raw) {
  if (raw === '{}' ) return { type: 'param' };
  if (raw === '{*}' || raw === '*' || raw === '**' || /^\*\w*$/.test(raw) || /^\[\[?\.\.\.[^\]]*\]\]?$/.test(raw)) return { type: 'wild' };
  if (/^:\w+\??$/.test(raw) || /\$\{[^}]*\}|\{[^}]*\}|<[^>]*>|^\[[^\]]*\]$/.test(raw)) return { type: 'param' };
  return { type: 'literal', text: raw };
}

/**
 * A parameter with a pattern (`{id:[0-9]+}`, `{name:[^/]+}`) may hold slashes
 * and braces: hold each, up to its balancing brace, as one piece.
 */
function holdPatternParams(text, holders) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{' && /^\{\w+\s*:/.test(text.slice(i))) {
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}' && --depth === 0) break;
      }
      if (j < text.length) {
        holders.push(text.slice(i, j + 1));
        out += `${HOLD}${holders.length - 1}${HOLD}`;
        i = j + 1;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/** Split a raw path into { host, segments } or null when it is not a string. */
export function parsePath(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  let host = null;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)(.*)$/i.exec(text);
  if (scheme) {
    host = normalizeHost(scheme[1]);
    text = scheme[2];
  }
  // Template expressions may hold slashes or question marks: protect them first.
  const holders = [];
  text = text.replace(/\$\{[^}]*\}/g, (m) => { holders.push(m); return `${HOLD}${holders.length - 1}${HOLD}`; });
  text = holdPatternParams(text, holders);
  text = text.split(/[?#]/)[0];
  const segments = text.split('/').filter((s) => s.length > 0)
    .map((s) => s.replace(HELD, (_, i) => holders[Number(i)]))
    .map(segmentOf);
  // A wildcard eats every following segment.
  const wild = segments.findIndex((s) => s.type === 'wild');
  return { host, segments: wild >= 0 ? segments.slice(0, wild + 1) : segments };
}

export function pathText(segments) {
  return `/${segments.map((s) => (s.type === 'literal' ? s.text : s.type === 'param' ? '{}' : '{*}')).join('/')}`;
}

export function normalizeHost(raw) {
  if (!isText(raw)) return null;
  return raw.trim().toLowerCase().replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/^www\./, '');
}

export function normalizeChannel(raw) {
  if (!isText(raw)) return null;
  return raw.trim().replace(PLACEHOLDER, '{}');
}

/** The literal pieces of a normalized channel (what must appear in the source). */
export function channelLiterals(channel) {
  return channel.split('{}').map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Normalize one end's address. Returns
 *   { ok: true, key, address, literals, methodWord? }   literals: case-sensitive
 *       pieces that must appear in the quoted lines; methodWord: case-insensitive
 *   { ok: false, reason }                                 unresolved
 * Throws nothing; an unknown kind is the caller's concern.
 */
export function normalizeAddress(kind, address) {
  if (address === null || typeof address !== 'object' || Array.isArray(address)) return { ok: false, reason: 'no address' };
  if (isText(address.unresolved)) return { ok: false, reason: address.unresolved.trim() };
  if (kind === 'http') {
    const parsed = parsePath(address.path);
    if (parsed === null) return { ok: false, reason: 'no path' };
    const literals = parsed.segments.filter((s) => s.type === 'literal').map((s) => s.text);
    if (parsed.segments.length > 0 && literals.length === 0) return { ok: false, reason: 'path has no literal segment' };
    const method = isText(address.method) ? address.method.trim().toUpperCase() : null;
    if (method === null) return { ok: false, reason: 'no method' };
    const host = normalizeHost(address.host) ?? parsed.host;
    const path = pathText(parsed.segments);
    return {
      ok: true,
      key: `${method} ${path}`,
      address: { method, path, ...(host ? { host } : {}) },
      segments: parsed.segments,
      literals,
      methodWord: method === 'GET' || ANY_METHODS.has(method) ? null : method,
    };
  }
  if (kind === 'rpc') {
    if (!isText(address.service) || !isText(address.method)) return { ok: false, reason: 'no service or method' };
    const service = address.service.trim().split('.').pop();
    const method = address.method.trim();
    return { ok: true, key: `${service}/${method}`, address: { service, method }, literals: [], methodWord: method, serviceWord: service };
  }
  if (kind === 'message' || kind === 'realtime') {
    const field = kind === 'message' ? 'channel' : 'event';
    const channel = normalizeChannel(address[field]);
    if (channel === null) return { ok: false, reason: `no ${field}` };
    const literals = channelLiterals(channel);
    if (literals.length === 0) return { ok: false, reason: `${field} has no literal part` };
    const namespace = isText(address.namespace) ? address.namespace.trim() : null;
    return {
      ok: true,
      key: channel,
      address: { [field]: channel, ...(namespace ? { namespace } : {}), ...(isText(address.broker) ? { broker: address.broker.trim() } : {}) },
      literals,
      namespace,
    };
  }
  if (kind === 'external') {
    const host = normalizeHost(address.host);
    const name = isText(address.name) ? address.name.trim().toLowerCase() : null;
    if (host === null && name === null) return { ok: false, reason: 'no name or host' };
    const words = { address: { ...(name ? { name } : {}), ...(host ? { host } : {}) }, literals: [], externalWords: [name, host].filter(Boolean) };
    const identity = externalIdentity({ name, host: address.host });
    if (!identity.ok) return { ...identity, ...words };
    return { ok: true, key: `external:${identity.id}`, keyBy: identity.by, ...words };
  }
  return { ok: false, reason: `unknown kind ${JSON.stringify(kind)}` };
}

const compact = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const SERVICE_OF = new Map(Object.entries(EXTERNAL_SERVICES.services).flatMap(([id, aliases]) => aliases.map((a) => [compact(a), id])));
const TRANSPORTS = new Set(EXTERNAL_SERVICES.transports.map(compact));
const PREFIXES = new Set(EXTERNAL_SERVICES.affixes.prefixes);
const SUFFIXES = new Set(EXTERNAL_SERVICES.affixes.suffixes);
const SECOND_LEVEL = new Set(EXTERNAL_SERVICES.secondLevelLabels);
const HOSTING = EXTERNAL_SERVICES.hostingDomains;
const PUBLIC_TLDS = new Set(EXTERNAL_SERVICES.publicTopLevelDomains);
/** A top-level domain of the public internet: any two-letter country domain or one listed. */
const isPublicTld = (label) => /^[a-z]{2}$/.test(label) || PUBLIC_TLDS.has(label);
const HOST_SHAPE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const DOMAIN_SHAPE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** A host as a bare lower-case host name (scheme, path and port removed), or null when it is not one. */
export function hostOf(raw) {
  if (!isText(raw)) return null;
  const bare = normalizeHost(raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0]);
  return bare !== null && HOST_SHAPE.test(bare) && /[a-z0-9]/.test(bare) ? bare : null;
}

/**
 * The organization label of a host: the label before its public suffix
 * (`api.openai.com` -> `openai`, `m.agency.gov.cn` -> `agency`). A host
 * under a hosting domain is a tenant's own system and keeps its whole host,
 * as does a host under any other than a public top-level domain (cluster,
 * service-discovery and private names: `orders.svc.cluster.local`); an IP
 * address or a one-label host is itself.
 */
export function hostLabel(host) {
  if (IPV4.test(host) || !host.includes('.')) return host;
  if (HOSTING.some((d) => host.endsWith(`.${d}`))) return host;
  const labels = host.split('.');
  if (!isPublicTld(labels.at(-1))) return host;
  const twoLevel = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2));
  return labels.at(twoLevel ? -3 : -2);
}

/** The words of a name: a scoped package gives its scope, a module path its last part; affixes go. */
function nameTokens(name) {
  let text = name.trim().toLowerCase();
  if (text.startsWith('@') && text.includes('/')) text = text.slice(1).split('/')[0];
  else if (text.includes('/')) text = text.split('/').filter(Boolean).pop() ?? '';
  const tokens = text.split(/[-_\s.]+/).filter(Boolean);
  while (tokens.length > 1 && PREFIXES.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && SUFFIXES.has(tokens.at(-1))) tokens.pop();
  return tokens;
}

/**
 * The id of an external system, by fixed rules: a host the address gives
 * wins (its organization label, joined to a listed service); a name shaped
 * like a domain is read as a host; otherwise the name, in compact form, is
 * looked up in the service table, then its first word. A library or protocol
 * (`axios`, `nodemailer`, `ldap`) names no system: unresolved, marked
 * `transport`. Any other name is its own id, marked `by: 'name'`.
 * Returns { ok: true, id, by: host|service|name } or { ok: false, reason, transport? }.
 */
export function externalIdentity({ name = null, host = null }) {
  const fromHost = (h) => {
    const label = hostLabel(h);
    return { ok: true, id: SERVICE_OF.get(compact(label)) ?? label, by: 'host' };
  };
  const bare = hostOf(host);
  if (bare !== null) return fromHost(bare);
  if (!isText(name)) return { ok: false, reason: 'no name and no usable host' };
  const lower = name.trim().toLowerCase();
  // A dotted name is a domain only under a public top-level domain and when its
  // first word is not a library: `http.Get` and `axios.post` are calls, not hosts.
  const dotted = lower.split('.');
  if (DOMAIN_SHAPE.test(lower) && isPublicTld(dotted.at(-1)) && !TRANSPORTS.has(compact(dotted[0]))) return fromHost(lower);
  const tokens = nameTokens(lower);
  const whole = compact(tokens.join(''));
  if (whole.length === 0) return { ok: false, reason: 'no name and no usable host' };
  if (SERVICE_OF.has(whole)) return { ok: true, id: SERVICE_OF.get(whole), by: 'service' };
  if (TRANSPORTS.has(whole)) return { ok: false, transport: true, reason: `names a library or protocol (${lower}), not the system it reaches, and gives no host` };
  const first = compact(tokens[0] ?? '');
  if (SERVICE_OF.has(first)) return { ok: true, id: SERVICE_OF.get(first), by: 'service' };
  if (TRANSPORTS.has(first)) return { ok: false, transport: true, reason: `names a library or protocol (${lower}), not the system it reaches, and gives no host` };
  return { ok: true, id: whole, by: 'name' };
}

export function methodsMatch(a, b) {
  return a === b || ANY_METHODS.has(a) || ANY_METHODS.has(b);
}

/**
 * Match a caller path against a receiver path (both segment lists). A
 * receiver parameter takes any caller segment; a receiver literal needs the
 * same caller literal: a caller variable is never taken to equal a word.
 * Returns null or { score: literal segments equal }.
 */
export function matchSegments(caller, receiver) {
  let score = 0;
  for (let i = 0; i < receiver.length; i++) {
    const r = receiver[i];
    if (r.type === 'wild') return { score };
    const c = caller[i];
    if (c === undefined) return null;
    if (c.type === 'wild') return null;
    if (r.type === 'param') continue;
    if (c.type !== 'literal' || c.text !== r.text) return null;
    score += 1;
  }
  return caller.length === receiver.length ? { score } : null;
}

/**
 * http: the receivers with the most equal literal segments win.
 * Pair one normalized caller with the receivers it may reach (already limited
 * to other sides and to its target unit). Returns
 *   { bucket: 'linked', receivers: [r] } | { bucket: 'ambiguous', receivers } | { bucket: 'caller-only', receivers: [] }.
 * `message` and `realtime` link every receiver with the same key (broadcast).
 */
export function pairCaller(kind, caller, receivers) {
  if (kind === 'external') return { bucket: 'linked', receivers: [] };
  if (kind === 'http') {
    let best = -1;
    let found = [];
    for (const r of receivers) {
      if (!methodsMatch(caller.address.method, r.address.method)) continue;
      const m = matchSegments(caller.segments, r.segments);
      if (m === null) continue;
      if (m.score > best) { best = m.score; found = [{ r, m }]; } else if (m.score === best) found.push({ r, m });
    }
    if (found.length === 0) return { bucket: 'caller-only', receivers: [] };
    if (found.length > 1) return { bucket: 'ambiguous', receivers: found.map((f) => f.r) };
    return { bucket: 'linked', receivers: [found[0].r] };
  }
  const same = receivers.filter((r) => r.key === caller.key
    && (!caller.namespace || !r.namespace || caller.namespace === r.namespace));
  if (same.length === 0) return { bucket: 'caller-only', receivers: [] };
  if (kind === 'rpc' && same.length > 1) return { bucket: 'ambiguous', receivers: same };
  return { bucket: 'linked', receivers: same };
}

export default { KINDS, normalizeAddress, externalIdentity, hostLabel, hostOf, parsePath, pathText, matchSegments, methodsMatch, pairCaller, normalizeChannel, normalizeHost };
