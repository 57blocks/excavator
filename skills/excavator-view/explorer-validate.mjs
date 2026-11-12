/**
 * explorer-validate.mjs
 *
 * Loads the explorer copy's own graph validator (openspec: changes/viewer-explorer,
 * design D4). The copy's `validateGraph` is a TypeScript module that imports zod;
 * the skill scripts run as plain Node, which has no TypeScript loader before 22.18,
 * so `pnpm build` bundles the copied module as it is into one CommonJS file
 * (`packages/explorer/dist-node/schema.cjs`, see `validator.config.ts`) and this
 * module loads that file synchronously. Nothing of the validator is rewritten here.
 *
 * `countIssues` is what the pack's result and the reply's `Explorer:` line say: the
 * number of issues the validator reports for a graph, and the same issues grouped by
 * `level:category`. A graph the validator refuses (a fatal) adds one issue when no
 * issue of its own carries the fatal message, so a refusal never reads as 0 issues.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/** Where the built validator is, relative to the plugin root. */
export const VALIDATOR_PATH = 'packages/explorer/dist-node/schema.cjs';

/** The copy's `validateGraph`; a validator that was not built is an error that says to build it. */
export function loadValidateGraph(path) {
  if (!existsSync(path)) {
    throw new Error(`the explorer validator ${path} does not exist: run \`pnpm build\` at the plugin root to build it`);
  }
  const { validateGraph } = createRequire(import.meta.url)(path);
  if (typeof validateGraph !== 'function') throw new Error(`the explorer validator ${path} does not export validateGraph; run \`pnpm build\` to rebuild it`);
  return validateGraph;
}

/**
 * @param {(data: unknown) => { issues: { level: string, category: string, message: string }[], fatal?: string }} validateGraph
 * @param {unknown} graph
 * @returns {{ total: number, byKind: Record<string, number>, fatal: string|null }}
 */
export function countIssues(validateGraph, graph) {
  const result = validateGraph(graph);
  const byKind = {};
  for (const issue of result.issues) {
    const kind = `${issue.level}:${issue.category}`;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  let total = result.issues.length;
  const fatal = typeof result.fatal === 'string' ? result.fatal : null;
  if (fatal !== null && !result.issues.some((issue) => issue.message === fatal)) {
    total += 1;
    byKind.fatal = (byKind.fatal ?? 0) + 1;
  }
  return { total, byKind: Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), fatal };
}
