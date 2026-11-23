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
 *   external  host lower-cased without port and `www.`, else the name
 *             lower-cased: `external:<name>`.
 * An address with no literal part (a path that is only a variable) is
 * unresolved, as is one the analyzer marked `unresolved`.
 */

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
    const id = host ?? name;
    if (id === null) return { ok: false, reason: 'no name or host' };
    return { ok: true, key: `external:${id}`, address: { ...(name ? { name } : {}), ...(host ? { host } : {}) }, literals: [], externalWords: [name, host].filter(Boolean) };
  }
  return { ok: false, reason: `unknown kind ${JSON.stringify(kind)}` };
}

export function methodsMatch(a, b) {
  return a === b || ANY_METHODS.has(a) || ANY_METHODS.has(b);
}

/**
 * Match a caller path against a receiver path (both segment lists).
 * Returns null or { score: literal segments equal, paramToLiteral }.
 */
export function matchSegments(caller, receiver) {
  let score = 0;
  let paramToLiteral = false;
  for (let i = 0; i < receiver.length; i++) {
    const r = receiver[i];
    if (r.type === 'wild') return { score, paramToLiteral };
    const c = caller[i];
    if (c === undefined) return null;
    if (c.type === 'wild') return null;
    if (r.type === 'param') continue;
    if (c.type === 'literal') {
      if (c.text !== r.text) return null;
      score += 1;
    } else {
      paramToLiteral = true;
    }
  }
  return caller.length === receiver.length ? { score, paramToLiteral } : null;
}

/**
 * http: the receivers with the most equal literal segments win; on a tie, those
 * that need no caller variable to equal a literal win.
 * Pair one normalized caller with the receivers it may reach (already limited
 * to other sides and to its target unit). Returns
 *   { bucket: 'linked', receivers: [r], paramToLiteral? } | { bucket: 'ambiguous', receivers } | { bucket: 'caller-only', receivers: [] }.
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
    // On a tie, a receiver that takes the caller's variable segments as
    // parameters beats one that needs a variable to equal a literal.
    if (found.length > 1 && found.some((f) => !f.m.paramToLiteral)) found = found.filter((f) => !f.m.paramToLiteral);
    if (found.length === 0) return { bucket: 'caller-only', receivers: [] };
    if (found.length > 1) return { bucket: 'ambiguous', receivers: found.map((f) => f.r) };
    return { bucket: 'linked', receivers: [found[0].r], paramToLiteral: found[0].m.paramToLiteral };
  }
  const same = receivers.filter((r) => r.key === caller.key
    && (!caller.namespace || !r.namespace || caller.namespace === r.namespace));
  if (same.length === 0) return { bucket: 'caller-only', receivers: [] };
  if (kind === 'rpc' && same.length > 1) return { bucket: 'ambiguous', receivers: same };
  return { bucket: 'linked', receivers: same };
}

export default { KINDS, normalizeAddress, parsePath, pathText, matchSegments, methodsMatch, pairCaller, normalizeChannel, normalizeHost };
