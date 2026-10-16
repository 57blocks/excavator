/**
 * domain-usability.mjs
 *
 * The pure half of the domain freshness gate (see domain-freshness.mjs for
 * the contract and the I/O wrapper that resolves the current values): given
 * an already-loaded domain graph and the current fact layer's
 * `sourceRevision` and `factDigest`, decide whether the domain graph is
 * usable. No I/O, no model call, no `node:` import of its own, so the view
 * page applies the very same rule to a dropped `.excavator/` directory.
 * `domain-freshness.mjs` re-exports it.
 *
 * Contract: openspec/changes/full-semantic-isolation/specs/domain-freshness/spec.md
 */

import { hasCanonicalDomainIdentity } from './domain-contract.mjs';
import {
  auditDomainGraphFields,
  isAcceptedLanguageAudit,
} from '../excavator/semantic-language-audit.mjs';

/**
 * Pure decision: is `domainGraph` usable against the given current values?
 * No I/O, no model call.
 *
 * @param {{
 *   domainGraph: object|null,
 *   currentSourceRevision: string|null,
 *   currentFactDigest: string|null,
 * }} args
 * @returns {{ usable: boolean, status: 'fresh'|'stale'|'missing'|'noncanonical-language', reason: string }}
 */
export function isDomainGraphUsable({ domainGraph, currentSourceRevision, currentFactDigest }) {
  if (!domainGraph || typeof domainGraph !== 'object') {
    return { usable: false, status: 'missing', reason: 'no domain graph to check' };
  }

  if (
    !hasCanonicalDomainIdentity(domainGraph)
    || !isAcceptedLanguageAudit(
      domainGraph.languageAudit,
      auditDomainGraphFields({ domainGraph }),
    )
  ) {
    return {
      usable: false,
      status: 'noncanonical-language',
      reason: 'noncanonical-language: domain graph lacks the current schema, contentLanguage=en, or an accepted field audit — re-run /excavator-domain',
    };
  }

  const domainSourceRevision = domainGraph.sourceRevision;
  if (typeof domainSourceRevision !== 'string' || domainSourceRevision.length === 0) {
    return {
      usable: false, status: 'stale',
      reason: 'domain graph carries no sourceRevision (produced before domain-freshness, or never stamped) — re-run /excavator-domain',
    };
  }

  const domainFactDigest = domainGraph.factDigest;
  if (typeof domainFactDigest !== 'string' || domainFactDigest.length === 0) {
    return {
      usable: false, status: 'stale',
      reason: 'domain graph carries no factDigest — re-run /excavator-domain',
    };
  }

  if (typeof currentSourceRevision !== 'string' || currentSourceRevision.length === 0) {
    return { usable: false, status: 'stale', reason: 'current sourceRevision could not be resolved' };
  }
  if (domainSourceRevision !== currentSourceRevision) {
    return {
      usable: false, status: 'stale',
      reason: `sourceRevision mismatch (domain graph: ${domainSourceRevision}, current: ${currentSourceRevision}) — the fact layer has moved since Domain last ran; re-run /excavator-domain`,
    };
  }

  if (typeof currentFactDigest !== 'string' || currentFactDigest.length === 0) {
    return { usable: false, status: 'stale', reason: 'no current knowledge-graph.jsonl / factsDigest to compare against' };
  }
  if (domainFactDigest !== currentFactDigest) {
    return {
      usable: false, status: 'stale',
      reason: `factDigest mismatch (domain graph: ${domainFactDigest.slice(0, 12)}…, current: ${currentFactDigest.slice(0, 12)}…) — the fact projection changed since Domain last ran; re-run /excavator-domain`,
    };
  }

  return { usable: true, status: 'fresh', reason: 'sourceRevision and factDigest both match the current fact layer' };
}
