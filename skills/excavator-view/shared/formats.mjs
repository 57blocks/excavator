/**
 * formats.mjs
 *
 * The line-format identifiers the shared readers check, copied from their
 * owners (`knowledge-graph-store.mjs`, `source-index-store.mjs`), which
 * import `node:` modules and so cannot be loaded by the page. A test pins
 * each copy to its owner's export, so the two can never drift.
 */

export const KNOWLEDGE_GRAPH_FORMAT = 'excavator-knowledge-graph-lines/1';
export const SOURCE_INDEX_FORMAT = 'excavator-source-index-lines/1';
