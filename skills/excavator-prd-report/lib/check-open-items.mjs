/**
 * `prd.mjs check-open-items <out> --project <root>` (openspec change
 * prd-report-dedupe, design D5). Lists the open items of the written features
 * (status recomputed from their files, as `aggregate` does) into
 * `open-items/sources.json`, checks `open-items/merged.json` against the list,
 * and prints one line for each problem of the merge, then
 * `Open items: <n> written in the chapters, <m> after merging` or
 * `... not merged`. Exit 0 when the merge passes or there are fewer than two
 * items (nothing to merge, no file needed), else 1. It writes only
 * `open-items/sources.json`; the merge file is the subagent's.
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { recomputeFeature } from './aggregate.mjs';
import { loadIndex, schemaProblems } from './index-check.mjs';
import { writeJson } from './json-file.mjs';
import { OPEN_ITEMS_DIR, SOURCES_FILE, openItemsOutcome } from './open-items.mjs';
import { projectRootProblem } from './project-root.mjs';

/** Run check-open-items on `<out>`. Returns { status, lines }. */
export function checkOpenItems(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const read = loadIndex(outDir);
  if (!read.ok) return { status: 1, lines: [read.line] };
  const schema = schemaProblems(read.value);
  if (schema.length > 0) return { status: 1, lines: schema };
  const index = read.value;
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) return { status: 1, lines: [rootProblem] };

  const features = index.features.map((feature) => recomputeFeature(outDir, index, feature, root).feature);
  const { sources, merge, line } = openItemsOutcome(outDir, { ...index, features });
  mkdirSync(join(outDir, OPEN_ITEMS_DIR), { recursive: true });
  writeJson(join(outDir, SOURCES_FILE), sources);
  return { status: merge.passing ? 0 : 1, lines: [...merge.problems, line] };
}
