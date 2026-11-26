import { describe, expect, it } from 'vitest';

import { unitFiles } from '../docmap-charts';
import { joinChecks } from '../docmap';

const evidence = (file: string, line: number) => ({ file, line, code: 'x' });

describe('the files of a unit', () => {
  it('gives the files of a unit\'s evidence, in the order they first appear', () => {
    const { rows } = joinChecks([{ code: { status: 'found', evidence: [evidence('src/a.js', 1), evidence('lib/b.py', 2), evidence('src/a.js', 9)] } }], null);
    expect(unitFiles(rows[0])).toEqual(['src/a.js', 'lib/b.py']);
  });
});
