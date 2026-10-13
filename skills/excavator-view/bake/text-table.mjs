/**
 * text-table.mjs
 *
 * Re-export of the shared per-segment string table (shared/text-table.mjs),
 * kept so existing bake imports keep their path.
 */

export { TextTable, utf8Length } from '../shared/text-table.mjs';
