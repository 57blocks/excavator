// openspec change handbook-skill-first, requirement "select the sections to write": `handbook.mjs sections <list>` validates the list
// and prints the files a run reads, from a fixed dependency table: every section by default, the shared map stage file once, the
// cross chapters' one file once, a fixed order whatever order the list is written in, and exit 1 with the allowed values otherwise.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SECTIONS, SECTIONS, parseSections, readPlan } from '../../../skills/excavator-product-handbook/lib/sections.mjs';
import { runHandbook } from './helpers.mjs';

const NAMES = ['system', 'features', 'data', 'history', 'domains', 'roles', 'notifications', 'topics', 'defects', 'review', 'remedies', 'outline'];
const DEFAULTS = NAMES.filter((name) => name !== 'review');

describe('parseSections', () => {
  it('defaults to every section but review when the list is not given or empty', () => {
    expect(SECTIONS).toEqual(NAMES);
    expect(DEFAULT_SECTIONS).toEqual(DEFAULTS);
    for (const text of [undefined, '', '   ']) expect(parseSections(text)).toEqual({ ok: true, sections: DEFAULTS });
  });

  it('--review adds review to the default, to a list, and always brings remedies and outline', () => {
    expect(parseSections(undefined, { review: true })).toEqual({ ok: true, sections: NAMES });
    expect(parseSections('features', { review: true })).toEqual({ ok: true, sections: ['features', 'review', 'remedies', 'outline'] });
    expect(parseSections('review', { review: false })).toEqual({ ok: true, sections: ['review', 'remedies', 'outline'] });
    expect(parseSections('remedies')).toEqual({ ok: true, sections: ['remedies'] });
  });

  it('returns the sections in the fixed order, without repeats, whatever order they are written in', () => {
    expect(parseSections([...NAMES].reverse().join(','))).toEqual({ ok: true, sections: NAMES });
    expect(parseSections(' features , features ')).toEqual({ ok: true, sections: ['features'] });
  });

  it('refuses a value that is not a section and names it and the allowed ones', () => {
    for (const bad of ['trace', 'features,trace', 'Features', 'features,', ',', 'features system', 'overview', 'priority', 'architecture']) {
      const result = parseSections(bad);
      expect(result.ok, bad).toBe(false);
      expect(result.lines[1], bad).toBe(`--sections takes ${NAMES.join(', ')}, any of them separated by a comma (default: all but review; --review adds review)`);
    }
    expect(parseSections('features,trace').lines[0]).toContain('"trace"');
    expect(parseSections('trace', { review: true }).ok).toBe(false);
    expect(parseSections('trace').lines[1]).toContain('defects, review, remedies, outline');
  });
});

describe('readPlan', () => {
  it('reads the map stage once, then each section file once, in run order', () => {
    expect(readPlan(NAMES)).toEqual(['stages/map.md', 'stages/cross-prompt.md', 'sections/system.md', 'sections/features.md', 'sections/data.md', 'sections/history.md', 'sections/cross.md', 'sections/review.md', 'sections/remedies.md', 'stages/outline.md']);
    expect(readPlan(DEFAULTS)).not.toContain('sections/review.md');
  });

  it('the five cross chapters before the design problems share one file, read once; review and remedies have their own', () => {
    expect(readPlan(['defects'])).toEqual(['stages/map.md', 'stages/cross-prompt.md', 'sections/cross.md']);
    expect(readPlan(['domains', 'roles', 'notifications', 'topics', 'defects'])).toEqual(['stages/map.md', 'stages/cross-prompt.md', 'sections/cross.md']);
    expect(readPlan(['review'])).toEqual(['stages/map.md', 'sections/review.md']);
    expect(readPlan(['remedies'])).toEqual(['stages/map.md', 'stages/cross-prompt.md', 'sections/remedies.md']);
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
    expect(all.lines).toEqual([`SECTIONS=${DEFAULTS.join(',')}`, ...readPlan(DEFAULTS).map((file) => `READ=${file}`)]);
    expect(all.lines.some((line) => line.startsWith('AFTER_TRACE='))).toBe(false);
    expect(runHandbook(['sections', 'remedies,features']).lines).toEqual(['SECTIONS=features,remedies', 'READ=stages/map.md', 'READ=stages/cross-prompt.md', 'READ=sections/features.md', 'READ=sections/remedies.md']);
  });

  it('--review adds review, remedies and outline; --sections review alone brings remedies and outline', () => {
    const withFlag = runHandbook(['sections', '', '--review']);
    expect(withFlag.status, withFlag.stderr).toBe(0);
    expect(withFlag.lines[0]).toBe(`SECTIONS=${NAMES.join(',')}`);
    expect(withFlag.lines).toContain('READ=sections/review.md');
    const only = runHandbook(['sections', 'review']);
    expect(only.lines[0]).toBe('SECTIONS=review,remedies,outline');
    expect(only.lines.slice(1)).toEqual(['READ=stages/map.md', 'READ=stages/cross-prompt.md', 'READ=sections/review.md', 'READ=sections/remedies.md', 'READ=stages/outline.md']);
    expect(runHandbook(['sections', '--review', 'features']).lines[0]).toBe('SECTIONS=features,review,remedies,outline');
    expect(runHandbook(['sections', 'features']).lines.join('\n')).not.toContain('review');
  });

  it('exits 1 with the allowed values for a value that is not a section', () => {
    const bad = runHandbook(['sections', 'features,trace']);
    expect(bad.status).toBe(1);
    expect(bad.lines[0]).toContain('"trace"');
    expect(bad.lines[1]).toContain('review');
  });

  it('every file it can print exists in the skill', async () => {
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const skill = fileURLToPath(new URL('../../../skills/excavator-product-handbook/', import.meta.url));
    for (const file of readPlan(NAMES)) expect(existsSync(skill + file), file).toBe(true);
  });
});
