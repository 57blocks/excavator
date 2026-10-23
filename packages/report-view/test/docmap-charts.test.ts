import { describe, expect, it } from 'vitest';

import { lookupBars, unitFiles, verdictBars } from '../src/lib/docmap-charts';
import { joinChecks } from '../src/lib/docmap';

const evidence = (file: string, line: number) => ({ file, line, code: 'x' });

describe('the distribution charts of the Doc map page', () => {
  it('takes the units by lookup status from the product counts', () => {
    expect(lookupBars({ found: 2, notFound: 1, notChecked: 0 })).toEqual({
      rows: [{ key: 'found', label: 'found', value: 2 }, { key: 'not-found', label: 'not found', value: 1 }, { key: 'not-checked', label: 'not checked', value: 0 }],
      missing: [],
    });
    expect(lookupBars({ found: 2 })).toMatchObject({ missing: ['not found', 'not checked'] });
  });

  it('counts each piece of evidence by the verdict of its check, and the evidence without one as not checked', () => {
    const units = [
      { code: { status: 'found', evidence: [evidence('a', 1), evidence('b', 2)] } },
      { code: { status: 'found', evidence: [evidence('c', 3)] } },
      { code: { status: 'not-found', evidence: [] } },
    ];
    const { rows } = joinChecks(units, [{ unit: 1, file: 'a', line: 1, verdict: 'does' }, { unit: 2, file: 'c', line: 3, verdict: 'odd' }]);
    expect(verdictBars(rows)).toEqual([
      { key: 'does', label: 'does', value: 1 },
      { key: 'not', label: 'not', value: 0 },
      { key: 'none', label: 'none', value: 0 },
      { key: 'not checked', label: 'not checked', value: 1 },
      { key: 'other', label: 'other verdict', value: 1 },
    ]);
  });

  it('gives the files of a unit\'s evidence, for the path filter', () => {
    const { rows } = joinChecks([{ code: { status: 'found', evidence: [evidence('src/a.js', 1), evidence('lib/b.py', 2), evidence('src/a.js', 9)] } }], null);
    expect(unitFiles(rows[0])).toEqual(['src/a.js', 'lib/b.py']);
  });
});
