import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUNTIME_PARAMS } from '../../deploy/run-excavator.mjs';

/**
 * docs/deploy.md is the operator-facing contract (design.md D7, task 4.1):
 * the table under "(a) Runtime parameters the operator passes" must name
 * exactly the set of variables run-excavator.mjs actually reads as
 * operator-facing config — no more (an undocumented-but-live variable is an
 * unadvertised surface) and no fewer (a documented-but-dead variable is a
 * lie). RUNTIME_PARAMS is the single source of truth on the code side; this
 * test is the doc's side of that contract.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const docPath = resolve(repoRoot, 'docs/deploy.md');

const START_MARKER = '<!-- runtime-params-table:start -->';
const END_MARKER = '<!-- runtime-params-table:end -->';

/**
 * Extracts the variable names documented in the runtime-parameters table,
 * delimited by a pair of HTML-comment markers rather than by locating "the"
 * markdown table structurally — a marker pair survives prose edits around
 * the table in a way that "the first table after this heading" would not.
 * Each data row is expected to open with `| \`NAME\` |`; the header and
 * separator rows contain no backtick-quoted cell and are ignored.
 */
export function parseDocumentedRuntimeParams(markdown) {
  const startIdx = markdown.indexOf(START_MARKER);
  const endIdx = markdown.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `docs/deploy.md is missing the ${START_MARKER} / ${END_MARKER} markers around the runtime-parameters table`,
    );
  }
  const block = markdown.slice(startIdx + START_MARKER.length, endIdx);
  const names = [];
  for (const line of block.split('\n')) {
    const match = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/.exec(line.trim());
    if (match) names.push(match[1]);
  }
  return names;
}

describe('docs/deploy.md runtime-parameters table (design D7, task 4.1)', () => {
  it('documents exactly RUNTIME_PARAMS, in both directions', () => {
    const markdown = readFileSync(docPath, 'utf-8');
    const documented = parseDocumentedRuntimeParams(markdown);

    // Guards the instrument itself: an empty parse (e.g. both markers
    // deleted, or the table body emptied) must not pass vacuously just
    // because "documented" and "exported" are both compared as sets.
    expect(documented.length).toBeGreaterThan(0);

    const documentedSet = new Set(documented);
    const exportedSet = new Set(RUNTIME_PARAMS);

    const missingFromDoc = [...exportedSet].filter((name) => !documentedSet.has(name));
    const extraInDoc = [...documentedSet].filter((name) => !exportedSet.has(name));

    expect(missingFromDoc).toEqual([]);
    expect(extraInDoc).toEqual([]);
  });

  it('has no duplicate variable name inside the table', () => {
    const markdown = readFileSync(docPath, 'utf-8');
    const documented = parseDocumentedRuntimeParams(markdown);
    expect(new Set(documented).size).toBe(documented.length);
  });
});

export default { parseDocumentedRuntimeParams };
