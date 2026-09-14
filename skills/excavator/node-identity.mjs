// The single deterministic node-identity authority.
//
// Slice A / Task 1 of the lazy-mode plan. This module is the ONE place a node id
// is derived; both the fact builder (deterministic fact layer) and any
// deterministic id lookup MUST route through it, so a logical node gets the same
// id on every run and under every SourceSnapshot adapter. Node identity is the
// dedup single-point-of-failure for on-demand semantics (later slices): an
// unstable id yields two cache entries and dangling semantics.
//
// Contract: openspec/changes/lazy-first-run/specs/node-identity/spec.md
//
// Id shape (kept close to the existing `type:path:name` so downstream prefixes
// still parse, but with the owner and signature discriminators the old scheme
// dropped — the known collapse fix):
//   file            -> file:<normPath>
//   function/method -> function:<normPath>:<owner#>?<name|@ordinal><(sig)>
//   class/other     -> <type>:<normPath>:<owner#>?<name|@ordinal>

/**
 * Normalize a source path so equivalent adapter representations collapse to one
 * value. Git-relative, "./"-prefixed and windows-separated forms of the same
 * file all normalize equal; a multi-repo member is prefixed as `<memberId>/…`.
 * @param {string} path
 * @param {{ memberId?: string|null }} [opts]
 * @returns {string}
 */
export function normalizePath(path, { memberId } = {}) {
  if (typeof path !== 'string') {
    throw new TypeError('normalizePath: path must be a string');
  }
  let p = path
    .replace(/\\/g, '/') // windows separators
    .replace(/\/{2,}/g, '/'); // duplicate slashes
  p = p.replace(/^\.\//, ''); // leading ./
  p = p.replace(/^\/+/, ''); // leading slash(es)
  if (memberId != null && String(memberId) !== '') {
    const m = String(memberId).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    p = `${m}/${p}`;
  }
  return p;
}

/**
 * Deterministic, compact signature segment from a parameter list (and an
 * optional return type). Whitespace within each token is collapsed so cosmetic
 * differences do not rotate the id, while a differing arity/param list does.
 * @param {string[]} [params]
 * @param {string} [returnType]
 * @returns {string} e.g. "(a,b)" or "(a,b):number"
 */
export function normalizeSignature(params, returnType) {
  const list = Array.isArray(params) ? params : [];
  const norm = list.map((x) => String(x).replace(/\s+/g, ' ').trim()).join(',');
  const rt = returnType != null && String(returnType).trim() !== ''
    ? `:${String(returnType).replace(/\s+/g, ' ').trim()}`
    : '';
  return `(${norm})${rt}`;
}

const FUNCTION_LIKE = new Set(['function', 'method']);

/**
 * Derive a stable node id.
 * @param {{
 *   type: string, path: string, name?: string, owner?: string|null,
 *   params?: string[], returnType?: string, signature?: string,
 *   ordinal?: number, memberId?: string|null,
 * }} d
 * @returns {string}
 */
export function deriveNodeId(d) {
  if (!d || typeof d.type !== 'string' || d.type === '') {
    throw new TypeError('deriveNodeId: type is required');
  }
  const normPath = normalizePath(d.path ?? '', { memberId: d.memberId });
  if (d.type === 'file') return `file:${normPath}`;

  const ownerSeg = (typeof d.owner === 'string' && d.owner.length > 0)
    ? `${d.owner}#`
    : '';

  let nameSeg;
  if (typeof d.name === 'string' && d.name.length > 0) {
    nameSeg = d.name;
  } else if (Number.isInteger(d.ordinal)) {
    // Last-resort fallback for anonymous / unnameable constructs. The ordinal is
    // the declaration index among same (path, owner, kind) — NOT a line number —
    // so inserting comments/blank lines/other-kind code before it does not move
    // it. Inserting a same-kind sibling before it does, invalidating only this
    // node's cache (recorded via provenance by the caller).
    nameSeg = `@${d.ordinal}`;
  } else {
    // fail-closed: never emit an unstable id for an unnameable node.
    throw new TypeError('deriveNodeId: anonymous node requires an integer ordinal');
  }

  let sigSeg = '';
  if (FUNCTION_LIKE.has(d.type)) {
    if (typeof d.signature === 'string' && d.signature.length > 0) {
      sigSeg = d.signature;
    } else if (d.params !== undefined) {
      sigSeg = normalizeSignature(d.params, d.returnType);
    }
  }

  return `${d.type}:${normPath}:${ownerSeg}${nameSeg}${sigSeg}`;
}

/**
 * Derive ids for a batch of declarations and surface identity collisions:
 * two distinguishable declarations (different lineRange) that map to the same id.
 * A collision is a visible error, never a silent merge.
 * @param {Array<object>} decls declarations accepted by {@link deriveNodeId}, each
 *   ideally carrying a distinguishing `lineRange`.
 * @returns {{ ids: string[], byId: Map<string, object[]>, collisions: Array<{id:string,count:number,decls:object[]}> }}
 */
export function collectNodeIds(decls) {
  const byId = new Map();
  for (const decl of decls) {
    const id = deriveNodeId(decl);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(decl);
  }
  const collisions = [];
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    const distinct = new Set(group.map((g) => JSON.stringify(g.lineRange ?? null)));
    if (distinct.size > 1) collisions.push({ id, count: group.length, decls: group });
  }
  return { ids: [...byId.keys()], byId, collisions };
}
