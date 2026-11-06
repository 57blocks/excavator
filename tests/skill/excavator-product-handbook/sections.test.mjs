// O1 of openspec change handbook-sections, O2 of handbook-data-tables and the findings section of handbook-feature-findings:
// `handbook.mjs sections <list>` validates the list and prints the files a run reads, from a fixed
// dependency table: all sections by default, one section, the shared map
// stage file once, a fixed order whatever order the list is written in, and
// exit 1 with the allowed values for a value that is not a section.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SECTIONS, SECTIONS, parseSections, readPlan } from '../../../skills/excavator-product-handbook/lib/sections.mjs';
import { runHandbook } from './helpers.mjs';

const ALL = ['SECTIONS=overview,features,data,findings', 'READ=stages/map.md', 'READ=sections/overview.md', 'READ=sections/features.md', 'READ=sections/data.md', 'READ=sections/findings.md'];

describe('parseSections', () => {
  it('defaults to every section when the list is not given or empty', () => {
    expect(SECTIONS).toEqual(['overview', 'features', 'data', 'findings']);
    expect(DEFAULT_SECTIONS).toEqual(SECTIONS);
    for (const text of [undefined, '', '   ']) expect(parseSections(text)).toEqual({ ok: true, sections: ['overview', 'features', 'data', 'findings'] });
  });

  it('returns the sections in the fixed order, without repeats, whatever order they are written in', () => {
    expect(parseSections('findings,data,features,overview')).toEqual({ ok: true, sections: ['overview', 'features', 'data', 'findings'] });
    expect(parseSections(' features , features ')).toEqual({ ok: true, sections: ['features'] });
  });

  it('refuses a value that is not a section and names it and the allowed ones', () => {
    for (const bad of ['tables', 'overview,tables', 'Overview', 'overview,', ',', 'overview features']) {
      const result = parseSections(bad);
      expect(result.ok, bad).toBe(false);
      expect(result.lines.join('\n'), bad).toContain('overview');
      expect(result.lines.join('\n'), bad).toContain('features');
      expect(result.lines.join('\n'), bad).toContain('data');
      expect(result.lines.join('\n'), bad).toContain('findings');
    }
    expect(parseSections('overview,tables').lines[0]).toContain('"tables"');
    expect(parseSections('tables').lines[1]).toBe('--sections takes overview, features, data, findings, any of them separated by a comma (default: all)');
  });
});

describe('readPlan', () => {
  it('lists the stage file before the section files and the shared map stage once', () => {
    expect(readPlan(['overview', 'features'])).toEqual(['stages/map.md', 'sections/overview.md', 'sections/features.md']);
    expect(readPlan(['overview', 'features', 'data'])).toEqual(['stages/map.md', 'sections/overview.md', 'sections/features.md', 'sections/data.md']);
    expect(readPlan(['overview', 'features', 'data', 'findings'])).toEqual(['stages/map.md', 'sections/overview.md', 'sections/features.md', 'sections/data.md', 'sections/findings.md']);
  });

  it('the findings section needs the map stage file, then its own file, and adds nothing to the others', () => {
    expect(readPlan(['findings'])).toEqual(['stages/map.md', 'sections/findings.md']);
    expect(readPlan(['data', 'findings'])).toEqual(['stages/map.md', 'sections/data.md', 'sections/findings.md']);
    expect(readPlan(['overview', 'features', 'data'])).not.toContain('sections/findings.md');
  });

  it('the data section needs no stage file: its own file only, whatever else is chosen', () => {
    expect(readPlan(['data'])).toEqual(['sections/data.md']);
    expect(readPlan(['overview', 'data'])).toEqual(['stages/map.md', 'sections/overview.md', 'sections/data.md']);
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

  it('prints the map stage file and the findings file for the findings section, and only those', () => {
    const result = runHandbook(['sections', 'findings']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual(['SECTIONS=findings', 'READ=stages/map.md', 'READ=sections/findings.md']);
  });

  it('prints only the data file for the data section: no map stage file', () => {
    const result = runHandbook(['sections', 'data']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual(['SECTIONS=data', 'READ=sections/data.md']);
    expect(runHandbook(['sections', 'overview,data']).lines).toEqual(['SECTIONS=overview,data', 'READ=stages/map.md', 'READ=sections/overview.md', 'READ=sections/data.md']);
  });

  it('prints the map stage file once when both sections are chosen', () => {
    const result = runHandbook(['sections', 'overview,features']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual(['SECTIONS=overview,features', 'READ=stages/map.md', 'READ=sections/overview.md', 'READ=sections/features.md']);
    expect(result.lines.filter((line) => line === 'READ=stages/map.md')).toHaveLength(1);
  });

  it('prints the same lines in the same order whatever order the list is written in', () => {
    expect(runHandbook(['sections', 'findings,data,features,overview']).lines).toEqual(ALL);
    expect(runHandbook(['sections', 'features,data,findings,overview,features']).lines).toEqual(ALL);
  });

  it('exits 1 and prints the allowed values for a value that is not a section, printing no READ line', () => {
    const result = runHandbook(['sections', 'tables,overview']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain('"tables"');
    expect(result.stdout).toContain('--sections takes overview, features, data, findings, any of them separated by a comma (default: all)');
    expect(result.lines.some((line) => line.startsWith('READ='))).toBe(false);
  });

  it('takes one list at most and no option', () => {
    expect(runHandbook(['sections', 'overview', 'features']).status).toBe(2);
    expect(runHandbook(['sections', '--sections', 'overview']).status).toBe(2);
  });
});
