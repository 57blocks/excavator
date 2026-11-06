// O1 of openspec change handbook-sections: `handbook.mjs sections <list>`
// validates the list and prints the files a run reads, from a fixed
// dependency table: all sections by default, one section, the shared map
// stage file once, a fixed order whatever order the list is written in, and
// exit 1 with the allowed values for a value that is not a section.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SECTIONS, SECTIONS, parseSections, readPlan } from '../../../skills/excavator-product-handbook/lib/sections.mjs';
import { runHandbook } from './helpers.mjs';

const ALL = ['SECTIONS=overview,features', 'READ=stages/map.md', 'READ=sections/overview.md', 'READ=sections/features.md'];

describe('parseSections', () => {
  it('defaults to every section when the list is not given or empty', () => {
    expect(SECTIONS).toEqual(['overview', 'features']);
    expect(DEFAULT_SECTIONS).toEqual(SECTIONS);
    for (const text of [undefined, '', '   ']) expect(parseSections(text)).toEqual({ ok: true, sections: ['overview', 'features'] });
  });

  it('returns the sections in the fixed order, without repeats, whatever order they are written in', () => {
    expect(parseSections('features,overview')).toEqual({ ok: true, sections: ['overview', 'features'] });
    expect(parseSections(' features , features ')).toEqual({ ok: true, sections: ['features'] });
  });

  it('refuses a value that is not a section and names it and the allowed ones', () => {
    for (const bad of ['data', 'overview,data', 'Overview', 'overview,', ',', 'overview features']) {
      const result = parseSections(bad);
      expect(result.ok, bad).toBe(false);
      expect(result.lines.join('\n'), bad).toContain('overview');
      expect(result.lines.join('\n'), bad).toContain('features');
    }
    expect(parseSections('overview,data').lines[0]).toContain('"data"');
  });
});

describe('readPlan', () => {
  it('lists the stage file before the section files and the shared map stage once', () => {
    expect(readPlan(['overview', 'features'])).toEqual(['stages/map.md', 'sections/overview.md', 'sections/features.md']);
  });

  it('a section needs the map stage file, then its own file', () => {
    expect(readPlan(['overview'])).toEqual(['stages/map.md', 'sections/overview.md']);
    expect(readPlan(['features'])).toEqual(['stages/map.md', 'sections/features.md']);
  });
});

describe('handbook.mjs sections', () => {
  it('prints every section and file for no list and for an empty list', () => {
    const none = runHandbook(['sections']);
    expect(none.status, none.stderr).toBe(0);
    expect(none.lines).toEqual(ALL);
    const empty = runHandbook(['sections', '']);
    expect(empty.status, empty.stderr).toBe(0);
    expect(empty.lines).toEqual(ALL);
  });

  it('prints the one section chosen and its files (the map stage file included)', () => {
    expect(runHandbook(['sections', 'overview']).lines).toEqual(['SECTIONS=overview', 'READ=stages/map.md', 'READ=sections/overview.md']);
    expect(runHandbook(['sections', 'features']).lines).toEqual(['SECTIONS=features', 'READ=stages/map.md', 'READ=sections/features.md']);
  });

  it('prints the map stage file once when both sections are chosen', () => {
    const result = runHandbook(['sections', 'overview,features']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual(ALL);
    expect(result.lines.filter((line) => line === 'READ=stages/map.md')).toHaveLength(1);
  });

  it('prints the same lines in the same order whatever order the list is written in', () => {
    expect(runHandbook(['sections', 'features,overview']).lines).toEqual(ALL);
    expect(runHandbook(['sections', 'features,overview,features']).lines).toEqual(ALL);
  });

  it('exits 1 and prints the allowed values for a value that is not a section, printing no READ line', () => {
    const result = runHandbook(['sections', 'data,overview']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain('"data"');
    expect(result.stdout).toContain('overview');
    expect(result.stdout).toContain('features');
    expect(result.lines.some((line) => line.startsWith('READ='))).toBe(false);
  });

  it('takes one list at most and no option', () => {
    expect(runHandbook(['sections', 'overview', 'features']).status).toBe(2);
    expect(runHandbook(['sections', '--sections', 'overview']).status).toBe(2);
  });
});
