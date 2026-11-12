// openspec change handbook-skill-first, requirement "select the sections to write": `handbook.mjs sections <list>` validates the list
// and prints the files a run reads, from a fixed dependency table: every section by default, the shared map stage file once, the
// cross chapters' one file once, a fixed order whatever order the list is written in, and exit 1 with the allowed values otherwise.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SECTIONS, SECTIONS, parseSections, readPlan } from '../../../skills/excavator-product-handbook/lib/sections.mjs';
import { runHandbook } from './helpers.mjs';

const NAMES = ['system', 'features', 'data', 'history', 'domains', 'roles', 'notifications', 'topics', 'findings', 'remedies', 'outline'];

describe('parseSections', () => {
  it('defaults to every section when the list is not given or empty', () => {
    expect(SECTIONS).toEqual(NAMES);
    expect(DEFAULT_SECTIONS).toEqual(NAMES);
    for (const text of [undefined, '', '   ']) expect(parseSections(text)).toEqual({ ok: true, sections: NAMES });
  });

  it('returns the sections in the fixed order, without repeats, whatever order they are written in', () => {
    expect(parseSections([...NAMES].reverse().join(','))).toEqual({ ok: true, sections: NAMES });
    expect(parseSections(' features , features ')).toEqual({ ok: true, sections: ['features'] });
  });

  it('refuses a value that is not a section and names it and the allowed ones', () => {
    for (const bad of ['trace', 'features,trace', 'Features', 'features,', ',', 'features system', 'overview', 'priority', 'architecture']) {
      const result = parseSections(bad);
      expect(result.ok, bad).toBe(false);
      expect(result.lines[1], bad).toBe(`--sections takes ${NAMES.join(', ')}, any of them separated by a comma (default: all)`);
    }
    expect(parseSections('features,trace').lines[0]).toContain('"trace"');
  });
});

describe('readPlan', () => {
  it('reads the map stage once, then each section file once, in run order', () => {
    expect(readPlan(NAMES)).toEqual(['stages/map.md', 'sections/system.md', 'sections/features.md', 'sections/data.md', 'sections/history.md', 'sections/cross.md', 'stages/outline.md']);
  });

  it('the six cross chapters share one file, read once', () => {
    expect(readPlan(['findings'])).toEqual(['stages/map.md', 'sections/cross.md']);
    expect(readPlan(['domains', 'roles', 'notifications', 'topics', 'findings', 'remedies'])).toEqual(['stages/map.md', 'sections/cross.md']);
  });

  it('data and history need no map stage', () => {
    expect(readPlan(['data'])).toEqual(['sections/data.md']);
    expect(readPlan(['data', 'history'])).toEqual(['sections/data.md', 'sections/history.md']);
  });

  it('a written section needs the map stage first', () => {
    expect(readPlan(['system'])).toEqual(['stages/map.md', 'sections/system.md']);
    expect(readPlan(['features'])).toEqual(['stages/map.md', 'sections/features.md']);
    expect(readPlan(['outline'])).toEqual(['stages/map.md', 'stages/outline.md']);
  });
});

describe('handbook.mjs sections', () => {
  it('prints SECTIONS= and the READ= lines, and nothing that waits for a later phase', () => {
    const all = runHandbook(['sections', '']);
    expect(all.status, all.stderr).toBe(0);
    expect(all.lines).toEqual([`SECTIONS=${NAMES.join(',')}`, ...readPlan(NAMES).map((file) => `READ=${file}`)]);
    expect(all.lines.some((line) => line.startsWith('AFTER_TRACE='))).toBe(false);
    expect(runHandbook(['sections', 'remedies,features']).lines).toEqual(['SECTIONS=features,remedies', 'READ=stages/map.md', 'READ=sections/features.md', 'READ=sections/cross.md']);
  });

  it('exits 1 with the allowed values for a value that is not a section', () => {
    const bad = runHandbook(['sections', 'features,trace']);
    expect(bad.status).toBe(1);
    expect(bad.lines[0]).toContain('"trace"');
  });

  it('every file it can print exists in the skill', async () => {
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const skill = fileURLToPath(new URL('../../../skills/excavator-product-handbook/', import.meta.url));
    for (const file of readPlan(NAMES)) expect(existsSync(skill + file), file).toBe(true);
  });
});
