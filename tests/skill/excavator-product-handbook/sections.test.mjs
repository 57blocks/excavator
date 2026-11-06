// O1 of openspec change handbook-sections, O2 of handbook-data-tables, the findings section of handbook-feature-findings and the
// system-findings section of handbook-system-findings and the priority section of handbook-findings-priority:
// `handbook.mjs sections <list>` validates the list and prints the files a run reads, from a fixed
// dependency table: all sections by default, one section, the shared map
// stage file once, a fixed order whatever order the list is written in, and
// exit 1 with the allowed values for a value that is not a section.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SECTIONS, SECTIONS, afterTracePlan, parseSections, readPlan } from '../../../skills/excavator-product-handbook/lib/sections.mjs';
import { runHandbook } from './helpers.mjs';

const ALL = ['SECTIONS=overview,features,data,findings,system-findings,priority,remedies', 'READ=stages/map.md', 'READ=sections/overview.md', 'READ=sections/features.md', 'READ=sections/data.md', 'READ=sections/findings.md', 'READ=sections/system-findings.md', 'AFTER_TRACE=sections/priority.md', 'AFTER_TRACE=sections/remedies.md'];

describe('parseSections', () => {
  it('defaults to every section when the list is not given or empty', () => {
    expect(SECTIONS).toEqual(['overview', 'features', 'data', 'findings', 'system-findings', 'priority', 'remedies']);
    expect(DEFAULT_SECTIONS).toEqual(SECTIONS);
    for (const text of [undefined, '', '   ']) expect(parseSections(text)).toEqual({ ok: true, sections: ['overview', 'features', 'data', 'findings', 'system-findings', 'priority', 'remedies'] });
  });

  it('returns the sections in the fixed order, without repeats, whatever order they are written in', () => {
    expect(parseSections('remedies,priority,system-findings,findings,data,features,overview')).toEqual({ ok: true, sections: ['overview', 'features', 'data', 'findings', 'system-findings', 'priority', 'remedies'] });
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
      expect(result.lines.join('\n'), bad).toContain('system-findings');
      expect(result.lines.join('\n'), bad).toContain('priority');
    }
    expect(parseSections('overview,tables').lines[0]).toContain('"tables"');
    expect(parseSections('tables').lines[1]).toBe('--sections takes overview, features, data, findings, system-findings, priority, remedies, any of them separated by a comma (default: all)');
  });
});

describe('readPlan', () => {
  it('lists the stage file before the section files and the shared map stage once', () => {
    expect(readPlan(['overview', 'features'])).toEqual(['stages/map.md', 'sections/overview.md', 'sections/features.md']);
    expect(readPlan(['overview', 'features', 'data'])).toEqual(['stages/map.md', 'sections/overview.md', 'sections/features.md', 'sections/data.md']);
    expect(readPlan(['overview', 'features', 'data', 'findings'])).toEqual(['stages/map.md', 'sections/overview.md', 'sections/features.md', 'sections/data.md', 'sections/findings.md']);
    expect(readPlan([...DEFAULT_SECTIONS])).toEqual(['stages/map.md', 'sections/overview.md', 'sections/features.md', 'sections/data.md', 'sections/findings.md', 'sections/system-findings.md']);
  });

  it('the system-findings section needs the map stage file, then its own file, after the findings file, and adds nothing to the others', () => {
    expect(readPlan(['system-findings'])).toEqual(['stages/map.md', 'sections/system-findings.md']);
    expect(readPlan(['findings', 'system-findings'])).toEqual(['stages/map.md', 'sections/findings.md', 'sections/system-findings.md']);
    expect(readPlan(['data', 'system-findings'])).toEqual(['stages/map.md', 'sections/data.md', 'sections/system-findings.md']);
    expect(readPlan(['overview', 'features', 'data', 'findings'])).not.toContain('sections/system-findings.md');
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

describe('the priority section (handbook-findings-priority, design D1)', () => {
  it('has no READ file and no stage file: the readPlan of every list leaves it out, and the map stage file is not read for it', () => {
    expect(readPlan(['priority'])).toEqual([]);
    expect(readPlan(['findings', 'priority'])).toEqual(['stages/map.md', 'sections/findings.md']);
    expect(readPlan(['data', 'priority'])).toEqual(['sections/data.md']);
    expect(readPlan([...DEFAULT_SECTIONS])).not.toContain('sections/priority.md');
  });

  it('is the one AFTER_TRACE file of a run that selects it, and of no other', () => {
    expect(afterTracePlan(['priority'])).toEqual(['sections/priority.md']);
    expect(afterTracePlan([...DEFAULT_SECTIONS])).toEqual(['sections/priority.md', 'sections/remedies.md']);
    expect(afterTracePlan(['overview', 'features', 'data', 'findings', 'system-findings'])).toEqual([]);
  });

  it('is last in the fixed order, after system-findings, whatever order the list is written in', () => {
    expect(parseSections('priority,overview').sections).toEqual(['overview', 'priority']);
    expect(SECTIONS.at(-2)).toBe('priority');
    expect(SECTIONS.indexOf('priority')).toBeGreaterThan(SECTIONS.indexOf('system-findings'));
  });

  it('is printed by handbook.mjs sections as an AFTER_TRACE line and not as a READ line', () => {
    const only = runHandbook(['sections', 'priority']);
    expect(only.status, only.stderr).toBe(0);
    expect(only.lines).toEqual(['SECTIONS=priority', 'AFTER_TRACE=sections/priority.md']);
    expect(runHandbook(['sections', 'findings,priority']).lines).toEqual(['SECTIONS=findings,priority', 'READ=stages/map.md', 'READ=sections/findings.md', 'AFTER_TRACE=sections/priority.md']);
    for (const list of ['priority', 'overview,priority', '']) expect(runHandbook(['sections', list]).lines.filter((line) => line === 'READ=sections/priority.md')).toEqual([]);
    expect(runHandbook(['sections', 'overview']).lines.some((line) => line.startsWith('AFTER_TRACE='))).toBe(false);
  });
});

// O1 of openspec change handbook-remedies, design D1: the remedies section is read after the trace too, after the priority one.
describe('the remedies section (handbook-remedies, design D1)', () => {
  it('has no READ file and no stage file, and is the last section in the fixed order', () => {
    expect(readPlan(['remedies'])).toEqual([]);
    expect(readPlan(['findings', 'remedies'])).toEqual(['stages/map.md', 'sections/findings.md']);
    expect(readPlan([...DEFAULT_SECTIONS])).not.toContain('sections/remedies.md');
    expect(SECTIONS.at(-1)).toBe('remedies');
    expect(parseSections('remedies,priority,overview').sections).toEqual(['overview', 'priority', 'remedies']);
  });

  it('is an AFTER_TRACE file, printed after the priority one, and alone when only it is selected', () => {
    expect(afterTracePlan(['remedies'])).toEqual(['sections/remedies.md']);
    expect(afterTracePlan(['priority', 'remedies'])).toEqual(['sections/priority.md', 'sections/remedies.md']);
    expect(runHandbook(['sections', 'remedies']).lines).toEqual(['SECTIONS=remedies', 'AFTER_TRACE=sections/remedies.md']);
    expect(runHandbook(['sections', 'remedies,priority']).lines).toEqual(['SECTIONS=priority,remedies', 'AFTER_TRACE=sections/priority.md', 'AFTER_TRACE=sections/remedies.md']);
    expect(runHandbook(['sections', 'priority']).lines).toEqual(['SECTIONS=priority', 'AFTER_TRACE=sections/priority.md']);
    for (const list of ['remedies', 'priority,remedies', '']) expect(runHandbook(['sections', list]).lines.filter((line) => line === 'READ=sections/remedies.md')).toEqual([]);
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

  it('prints the map stage file and the system-findings file for the system-findings section, and only those', () => {
    const result = runHandbook(['sections', 'system-findings']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual(['SECTIONS=system-findings', 'READ=stages/map.md', 'READ=sections/system-findings.md']);
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
    expect(runHandbook(['sections', 'remedies,priority,system-findings,findings,data,features,overview']).lines).toEqual(ALL);
    expect(runHandbook(['sections', 'features,data,remedies,priority,system-findings,findings,overview,features']).lines).toEqual(ALL);
  });

  it('exits 1 and prints the allowed values for a value that is not a section, printing no READ line', () => {
    const result = runHandbook(['sections', 'tables,overview']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain('"tables"');
    expect(result.stdout).toContain('--sections takes overview, features, data, findings, system-findings, priority, remedies, any of them separated by a comma (default: all)');
    expect(result.lines.some((line) => line.startsWith('READ='))).toBe(false);
  });

  it('takes one list at most and no option', () => {
    expect(runHandbook(['sections', 'overview', 'features']).status).toBe(2);
    expect(runHandbook(['sections', '--sections', 'overview']).status).toBe(2);
  });
});
