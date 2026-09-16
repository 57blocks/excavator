#!/usr/bin/env node
import { createHash } from 'node:crypto';
/**
 * Deterministic language audit for persisted model-authored semantic fields.
 *
 * The audit does not trust a product's `contentLanguage` marker and exposes no
 * model-controlled exemption list. A non-Latin span is masked only when the
 * exact bytes occur in source-owned fields from the current fact graph or in
 * a current SourceSnapshot search result. The original value is never
 * rewritten; masking exists only inside the language decision.
 */

export const NONCANONICAL_LANGUAGE = 'noncanonical-language';

const SOURCE_OWNED_NODE_FIELDS = Object.freeze([
  'id', 'name', 'filePath', 'identifier', 'literal', 'excerpt',
]);
const DOMAIN_META_NON_PROSE_FIELDS = new Set([
  'entryType', 'id', 'type', 'kind', 'status', 'filePath', 'lineRange',
  'nodeIds', 'source', 'target', 'direction', 'provenance',
]);

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function valueDigest(value) {
  return `sha256:${createHash('sha256').update(String(value), 'utf-8').digest('hex')}`;
}

/** Maximal runs of non-Latin letters (plus combining marks). */
function nonLatinSpans(value) {
  const spans = [];
  let current = '';
  const flush = () => {
    if (current.length > 0 && !spans.includes(current)) spans.push(current);
    current = '';
  };

  for (const char of String(value)) {
    if (/\p{L}/u.test(char)) {
      if (/\p{Script=Latin}/u.test(char)) flush();
      else current += char;
    } else if (/\p{M}/u.test(char) && current.length > 0) {
      current += char;
    } else {
      flush();
    }
  }
  flush();
  return spans;
}

function pushString(fields, fieldPath, value) {
  if (typeof value === 'string') fields.push({ fieldPath, value });
}

function cacheFields(fields) {
  const out = [];
  pushString(out, 'summary', fields?.summary);
  if (Array.isArray(fields?.tags)) {
    fields.tags.forEach((tag, index) => pushString(out, `tags[${index}]`, tag));
  }
  return out;
}

function semanticGraphFields(layers, relations) {
  const out = [];
  for (const [index, layer] of (Array.isArray(layers) ? layers : []).entries()) {
    pushString(out, `layers[${index}].name`, layer?.name);
    pushString(out, `layers[${index}].description`, layer?.description);
  }
  for (const [index, relation] of (Array.isArray(relations) ? relations : []).entries()) {
    pushString(out, `relations[${index}].description`, relation?.description);
  }
  return out;
}

function collectDomainMetaStrings(value, fieldPath, out, key = '') {
  if (DOMAIN_META_NON_PROSE_FIELDS.has(key)) return;
  if (typeof value === 'string') {
    pushString(out, fieldPath, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectDomainMetaStrings(entry, `${fieldPath}[${index}]`, out, key));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const childKey of Object.keys(value)) {
    collectDomainMetaStrings(value[childKey], `${fieldPath}.${childKey}`, out, childKey);
  }
}

function domainGraphFields(domainGraph) {
  const out = [];
  pushString(out, 'project.description', domainGraph?.project?.description);
  for (const [index, node] of (Array.isArray(domainGraph?.nodes) ? domainGraph.nodes : []).entries()) {
    pushString(out, `nodes[${index}].name`, node?.name);
    pushString(out, `nodes[${index}].summary`, node?.summary);
    if (Array.isArray(node?.tags)) {
      node.tags.forEach((tag, tagIndex) => pushString(out, `nodes[${index}].tags[${tagIndex}]`, tag));
    }
    if (node?.domainMeta && typeof node.domainMeta === 'object') {
      collectDomainMetaStrings(node.domainMeta, `nodes[${index}].domainMeta`, out);
    }
  }
  for (const [index, edge] of (Array.isArray(domainGraph?.edges) ? domainGraph.edges : []).entries()) {
    pushString(out, `edges[${index}].description`, edge?.description);
  }
  return out;
}

function sourceOwnedFactValues(factGraph, allowedPaths) {
  const values = [];
  const pathSet = Array.isArray(allowedPaths) && allowedPaths.length > 0
    ? new Set(allowedPaths)
    : null;

  if (!pathSet) {
    pushString(values, 'project.name', factGraph?.project?.name);
    for (const value of factGraph?.project?.languages ?? []) pushString(values, 'project.languages', value);
    for (const value of factGraph?.project?.frameworks ?? []) pushString(values, 'project.frameworks', value);
  }

  for (const node of Array.isArray(factGraph?.nodes) ? factGraph.nodes : []) {
    if (pathSet && (!node?.filePath || !pathSet.has(node.filePath))) continue;
    for (const key of SOURCE_OWNED_NODE_FIELDS) pushString(values, key, node?.[key]);
  }
  return values.map((entry) => entry.value);
}

function authoritativeSpans(fields, { factGraph, sourceSnapshot, sourcePaths } = {}) {
  const suspicious = [...new Set(fields.flatMap((field) => nonLatinSpans(field.value)))];
  const verified = new Set();
  if (suspicious.length === 0) return verified;

  const factValues = sourceOwnedFactValues(factGraph, sourcePaths);
  for (const span of suspicious) {
    if (factValues.some((value) => value.includes(span))) verified.add(span);
  }

  if (sourceSnapshot && typeof sourceSnapshot.search === 'function') {
    const allowed = Array.isArray(sourcePaths) && sourcePaths.length > 0
      ? new Set(sourcePaths)
      : null;
    try {
      for (const result of sourceSnapshot.search(suspicious)) {
        if (allowed && !allowed.has(result?.path)) continue;
        if (typeof result?.term === 'string' && suspicious.includes(result.term)) {
          verified.add(result.term);
        }
      }
    } catch {
      // An unavailable or drifting snapshot grants no exemption. The field
      // remains in the rejected bucket instead of becoming an I/O failure.
    }
  }
  return verified;
}

function auditFields(fields, authority) {
  const verified = authoritativeSpans(fields, authority);
  const accepted = [];
  const rejected = [];

  for (const field of fields) {
    const suspicious = nonLatinSpans(field.value);
    const unverifiedSpans = suspicious.filter((span) => !verified.has(span));
    if (unverifiedSpans.length > 0) {
      rejected.push({
        fieldPath: field.fieldPath,
        valueDigest: valueDigest(field.value),
        reason: NONCANONICAL_LANGUAGE,
        unverifiedSpans,
      });
      continue;
    }
    const maskedSourceSpans = suspicious.filter((span) => verified.has(span)).sort(compareStrings);
    accepted.push({
      fieldPath: field.fieldPath,
      valueDigest: valueDigest(field.value),
      ...(maskedSourceSpans.length > 0 ? { maskedSourceSpans } : {}),
    });
  }

  return {
    status: rejected.length === 0 ? 'accepted' : 'rejected',
    inspected: fields.length,
    accepted,
    rejected,
  };
}

export function auditSemanticCacheFields({ fields, factGraph = null, sourceSnapshot = null, sourcePaths = null } = {}) {
  return auditFields(cacheFields(fields), { factGraph, sourceSnapshot, sourcePaths });
}

export function auditSemanticGraphFields({
  layers = [], relations = [], factGraph = null, sourceSnapshot = null,
} = {}) {
  return auditFields(semanticGraphFields(layers, relations), { factGraph, sourceSnapshot });
}

export function auditDomainGraphFields({ domainGraph, factGraph = null, sourceSnapshot = null } = {}) {
  return auditFields(domainGraphFields(domainGraph), { factGraph, sourceSnapshot });
}

export function isAcceptedLanguageAudit(audit, expectedFields = null) {
  const digestPattern = /^sha256:[a-f0-9]{64}$/;
  const structurallyAccepted = audit?.status === 'accepted'
    && Number.isInteger(audit.inspected)
    && audit.inspected >= 0
    && Array.isArray(audit.accepted)
    && Array.isArray(audit.rejected)
    && audit.rejected.length === 0
    && audit.inspected === audit.accepted.length
    && audit.accepted.every((entry) => (
      typeof entry?.fieldPath === 'string'
      && digestPattern.test(entry?.valueDigest)
    ))
    && new Set(audit.accepted.map((entry) => entry.fieldPath)).size === audit.accepted.length;
  if (!structurallyAccepted) return false;
  if (!expectedFields) return true;

  const expectedBindings = [...(expectedFields.accepted ?? []), ...(expectedFields.rejected ?? [])]
    .map((entry) => `${entry.fieldPath}\0${entry.valueDigest}`)
    .sort(compareStrings);
  const acceptedBindings = audit.accepted
    .map((entry) => `${entry.fieldPath}\0${entry.valueDigest}`)
    .sort(compareStrings);
  return audit.inspected === expectedBindings.length
    && JSON.stringify(acceptedBindings) === JSON.stringify(expectedBindings);
}

export default {
  NONCANONICAL_LANGUAGE,
  auditSemanticCacheFields,
  auditSemanticGraphFields,
  auditDomainGraphFields,
  isAcceptedLanguageAudit,
};
