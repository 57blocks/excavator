/** Deterministic identity of every persisted domain-graph semantic product. */
export const DOMAIN_GRAPH_VERSION = '2.0.0';
export const DOMAIN_CONTENT_LANGUAGE = 'en';

export function hasCanonicalDomainIdentity(domainGraph) {
  return domainGraph?.version === DOMAIN_GRAPH_VERSION
    && domainGraph?.contentLanguage === DOMAIN_CONTENT_LANGUAGE;
}

export default {
  DOMAIN_GRAPH_VERSION,
  DOMAIN_CONTENT_LANGUAGE,
  hasCanonicalDomainIdentity,
};
