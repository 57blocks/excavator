/**
 * semantic-cache-freshness.mjs
 *
 * The read-side trust rules of the semantic cache, with no I/O and no
 * `node:` import of their own: the cache identity (schema version and
 * canonical content language), the cacheable-field allowlist, the entry gate
 * (allowlist plus an accepted language audit bound to the entry's prose), and
 * `freshnessOf` (identity plus a hash comparison against the manifest's
 * per-file `contentHash`). `semantic-cache.mjs` owns the cache and re-exports
 * every name here; this module exists so the view page can apply the very
 * same rules to a dropped `.excavator/` directory in the browser.
 *
 * Contract: openspec/changes/hybrid-retrieval/specs/semantic-cache/spec.md
 */

import {
  auditSemanticCacheFields,
  isAcceptedLanguageAudit,
} from './semantic-language-audit.mjs';

export const SEMANTIC_CACHE_VERSION = '2.0.0';
export const CANONICAL_CONTENT_LANGUAGE = 'en';

/** The ONLY fields a semantic-cache entry may carry (spec Requirement
 *  "on-demand node-local semantic supplement": cacheable fields limited to
 *  the node/file's own summary, local tags, the hash it was generated
 *  against, and model/time provenance). Anything else — a cross-file
 *  conclusion, a business flow, answer text — is rejected outright.
 *
 *  `verification` (openspec: changes/full-semantic-isolation, capability
 *  `full-semantic-isolation`) is a minimal, additive extension: it is the
 *  Summary-Verifier's verdict ABOUT this entry's own `summary` — the same
 *  four-state field `verification-state.mjs` already governs for a
 *  knowledge-graph node — so Full mode's Summary-Verifier can record that
 *  verdict beside the cached summary it checked, without ever touching
 *  `knowledge-graph.jsonl`. */
export const CACHEABLE_FIELDS = Object.freeze([
  'summary', 'tags', 'semanticSourceHash', 'model', 'generatedAt', 'verification',
]);

/**
 * @param {object|null|undefined} entry a semantic-cache entry, or absent
 * @param {string|null|undefined} currentContentHash the node's file's
 *   CURRENT content hash per `source-manifest.json` (see
 *   `currentSourceHashFor` in semantic-cache.mjs, the same lookup the
 *   write-side CAS uses internally).
 * @param {string|object|null|undefined} cacheIdentity either the cache's
 *   `contentLanguage` value or the complete cache object. Passing the cache
 *   object also enforces the current schema version.
 * @returns {'fresh'|'missing'|'stale'|'noncanonical-language'}
 */
export function freshnessOf(entry, currentContentHash, cacheIdentity) {
  if (!entry || typeof entry.semanticSourceHash !== 'string' || entry.semanticSourceHash.length === 0) {
    return 'missing';
  }
  const canonicalIdentity = typeof cacheIdentity === 'string'
    ? cacheIdentity === CANONICAL_CONTENT_LANGUAGE
    : isCanonicalSemanticCache(cacheIdentity);
  if (!canonicalIdentity) return 'noncanonical-language';
  if (!isCanonicalSemanticCacheEntry(entry)) return 'noncanonical-language';
  if (typeof currentContentHash !== 'string' || currentContentHash.length === 0) return 'missing';
  return entry.semanticSourceHash === currentContentHash ? 'fresh' : 'stale';
}

/** Convenience boolean form of {@link freshnessOf} — `true` only for `'fresh'`. */
export function isFresh(entry, currentContentHash, cacheIdentity) {
  return freshnessOf(entry, currentContentHash, cacheIdentity) === 'fresh';
}

export function isCanonicalSemanticCache(cache) {
  return cache?.version === SEMANTIC_CACHE_VERSION
    && cache?.contentLanguage === CANONICAL_CONTENT_LANGUAGE;
}

/** @param {object} fields @returns {{ ok: boolean, rejectedFields: string[] }} */
export function validateCacheableFields(fields) {
  const keys = Object.keys(fields ?? {});
  const rejectedFields = keys.filter((k) => !CACHEABLE_FIELDS.includes(k));
  if (typeof fields?.summary !== 'string' && !rejectedFields.includes('summary')) {
    rejectedFields.push('summary');
  }
  if (
    Object.hasOwn(fields ?? {}, 'tags')
    && (!Array.isArray(fields.tags) || fields.tags.some((tag) => typeof tag !== 'string'))
    && !rejectedFields.includes('tags')
  ) {
    rejectedFields.push('tags');
  }
  return { ok: rejectedFields.length === 0, rejectedFields };
}

/**
 * Read-side entry gate. `languageAudit` is writer-owned metadata rather than
 * a cacheable model field, so remove only that key before applying the same
 * allowlist/type rules used by the writer. The audit must then bind to the
 * exact current prose bytes; pre-digest and mutated entries are noncanonical.
 */
export function isCanonicalSemanticCacheEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const { languageAudit, ...fields } = entry;
  if (!validateCacheableFields(fields).ok) return false;
  return isAcceptedLanguageAudit(
    languageAudit,
    auditSemanticCacheFields({ fields }),
  );
}
