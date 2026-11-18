/**
 * What the remedies chapter reads (openspec change handbook-design-review, D6): defects.md and review.md. The
 * check records the digest of both with a passed remedies chapter, the way it records the digest of domains.json
 * with the domains chapter; `remedies-state` says whether a passed chapter is stale, that is whether either file
 * changed since, or review.md appeared after a chapter that never read it.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UNAVAILABLE, diskChapters, itemNumbers, readMapOrNull } from './item-numbers.mjs';
import { loadStateV2 } from './state-v2.mjs';
import { loadUi } from './ui.mjs';

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

const phrase = (name, state) => `${name}.md ${UNAVAILABLE[state]}`;

/** The lines of one table: `<TAG> <id> ...` and an indented `cites:` line per item, or one line saying the source is not available. */
function tableLines(tag, source, file, line) {
  if (source.state !== 'ok') return [`${tag} none: ${phrase(file, source.state)}`];
  if (source.items.length === 0) return [`${tag} none: ${file}.md has no items`];
  return source.items.flatMap((entry) => [line(entry), `  cites: ${entry.cites.length === 0 ? 'none' : entry.cites.join('; ')}`]);
}

/** `remedies-inputs <out>`: the tables of the defects and the design problems, numbered the way the page and the checks number them. Returns { status, lines }. */
export function remediesInputsLines(outDir) {
  const ui = loadUi(outDir);
  if (!ui.ok) return { status: 1, lines: ui.lines };
  const map = readMapOrNull(outDir);
  if (map === null) return { status: 1, lines: ['map.json is missing or has no features list'] };
  const loaded = loadStateV2(outDir);
  if (!loaded.ok) return { status: 1, lines: [loaded.line] };
  const chapters = diskChapters(outDir, ['defects', 'review'], loaded.state);
  const numbers = itemNumbers({ outDir, map, chapters, strings: ui.strings });
  return {
    status: 0,
    lines: [
      ...tableLines('DEFECT', numbers.defects, 'defects', (e) => `DEFECT ${e.id} ${e.level} ${e.category} ${e.features.join(',')} ${e.title}`),
      ...tableLines('DESIGN', numbers.design, 'review', (e) => `DESIGN ${e.id} ${e.impact} ${e.dimension} ${e.features.join(',')} ${e.title}`),
    ],
  };
}
