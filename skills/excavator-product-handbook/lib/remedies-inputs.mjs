/**
 * What the remedies chapter reads (openspec change handbook-design-review, D6): defects.md and review.md. The
 * check records the digest of both with a passed remedies chapter, the way it records the digest of domains.json
 * with the domains chapter; `remedies-state` says whether a passed chapter is stale, that is whether either file
 * changed since, or review.md appeared after a chapter that never read it.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadStateV2 } from './state-v2.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digestOf = (outDir, name) => {
  const path = join(outDir, 'chapters', `${name}.md`);
  return existsSync(path) ? sha(readFileSync(path)) : 'none';
};

/** The digest of the chapters the remedies read. */
export const remediesInputs = (outDir) => sha(`defects:${digestOf(outDir, 'defects')}\nreview:${digestOf(outDir, 'review')}`);

/** `remedies-state <out>`. Returns { status, lines }. */
export function remediesState(outDir) {
  const loaded = loadStateV2(outDir);
  if (!loaded.ok) return { status: 1, lines: [loaded.line] };
  const record = loaded.state.chapters.remedies;
  const file = existsSync(join(outDir, 'chapters', 'remedies.md'));
  let stale = false;
  if (record !== undefined && record.status === 'passed') {
    stale = record.inputs === undefined ? existsSync(join(outDir, 'chapters', 'review.md')) : record.inputs !== remediesInputs(outDir);
  }
  return { status: 0, lines: [`STATUS=${record?.status ?? 'none'}`, `ATTEMPTS=${record?.attempts ?? 0}`, `FILE=${file ? 'yes' : 'no'}`, `STALE=${stale ? 'yes' : 'no'}`] };
}
