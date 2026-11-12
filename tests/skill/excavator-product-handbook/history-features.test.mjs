// The "features" column of the hotspot table comes from the citations of the recorded feature
// chapters (state.json format /2), so a run of Markdown chapters names its features there.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { featuresByFile } from '../../../skills/excavator-product-handbook/lib/history-features.mjs';

const dirs = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

function out(chapters, recorded, format = 'excavator-product-handbook-state/2') {
  const dir = mkdtempSync(join(tmpdir(), 'hb-hist-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'chapters'));
  for (const [name, text] of Object.entries(chapters)) writeFileSync(join(dir, 'chapters', `${name}.md`), text);
  const records = Object.fromEntries(recorded.map((name) => [name, { status: 'passed', attempts: 1, reasons: [], sha256: 'x' }]));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ format, chapters: records }));
  return dir;
}

describe('featuresByFile', () => {
  it('maps each cited file to the recorded feature chapters that cite it, in feature-number order', () => {
    const dir = out({
      F10: '# B\n\nIt sends (`src/a.js:1-3`; `src/b.js:4`).\n',
      F2: '# A\n\nIt saves (`src/a.js:7`).\n\n| X | Y |\n| --- | --- |\n| one | two (`src/c.js:2`) |\n',
      F3: '# C\n\nNot recorded (`src/a.js:1`).\n',
      system: '# S\n\nShared (`src/a.js:1`).\n',
    }, ['F10', 'F2', 'system']);
    const byFile = featuresByFile(dir);
    expect(Object.fromEntries(byFile)).toEqual({ 'src/a.js': ['F2', 'F10'], 'src/c.js': ['F2'], 'src/b.js': ['F10'] });
  });

  it('names no feature for a state of another format or no chapters directory', () => {
    expect(featuresByFile(out({ F1: '# A\n\nIt saves (`src/a.js:7`).\n' }, ['F1'], 'excavator-product-handbook-state/1')).size).toBe(0);
    const empty = mkdtempSync(join(tmpdir(), 'hb-hist-'));
    dirs.push(empty);
    expect(featuresByFile(empty).size).toBe(0);
  });
});
