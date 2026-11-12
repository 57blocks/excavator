// O1 of openspec change handbook-sections, O2 of handbook-data-tables, the findings section of handbook-feature-findings and the
// system-findings section of handbook-system-findings and the priority section of handbook-findings-priority:
// `handbook.mjs sections <list>` validates the list and prints the files a run reads, from a fixed
// dependency table: all sections by default, one section, the shared map
// stage file once, a fixed order whatever order the list is written in, and
// exit 1 with the allowed values for a value that is not a section.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SECTIONS, SECTIONS, afterTracePlan, parseSections, readPlan } from '../../../skills/excavator-product-handbook/lib/sections.mjs';
import { runHandbook } from './helpers.mjs';

const ALL = ['SECTIONS=overview,features,data,history,architecture,findings,system-findings,priority,remedies,topics,outline', 'READ=stages/map.md', 'READ=sections/system.md', 'READ=sections/features.md', 'READ=sections/data.md', 'READ=sections/history.md', 'AFTER_TRACE=sections/priority.md', 'AFTER_TRACE=sections/remedies.md', 'AFTER_TRACE=sections/topics.md', 'AFTER_TRACE=stages/outline.md'];

describe('parseSections', () => {
  it('defaults to every section when the list is not given or empty', () => {
    expect(SECTIONS).toEqual(['overview', 'features', 'data', 'history', 'architecture', 'findings', 'system-findings', 'priority', 'remedies', 'topics', 'outline']);
    expect(DEFAULT_SECTIONS).toEqual(SECTIONS);
    for (const text of [undefined, '', '   ']) expect(parseSections(text)).toEqual({ ok: true, sections: ['overview', 'features', 'data', 'history', 'architecture', 'findings', 'system-findings', 'priority', 'remedies', 'topics', 'outline'] });
  });

  it('returns the sections in the fixed order, without repeats, whatever order they are written in', () => {
    expect(parseSections('outline,topics,remedies,priority,system-findings,findings,architecture,history,data,features,overview')).toEqual({ ok: true, sections: ['overview', 'features', 'data', 'history', 'architecture', 'findings', 'system-findings', 'priority', 'remedies', 'topics', 'outline'] });
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
    expect(parseSections('tables').lines[1]).toBe('--sections takes overview, features, data, history, architecture, findings, system-findings, priority, remedies, topics, outline, any of them separated by a comma (default: all)');
  });
});

describe('readPlan', () => {
  it('lists the stage file before the section files and the shared map stage once', () => {
    expect(readPlan(['overview', 'features'])).toEqual(['stages/map.md', 'sections/system.md', 'sections/features.md']);
    expect(readPlan(['overview', 'features', 'data'])).toEqual(['stages/map.md', 'sections/system.md', 'sections/features.md', 'sections/data.md']);
    expect(readPlan(['overview', 'features', 'data', 'findings'])).toEqual(['stages/map.md', 'sections/system.md', 'sections/features.md', 'sections/data.md']);
    expect(readPlan([...DEFAULT_SECTIONS])).toEqual(['stages/map.md', 'sections/system.md', 'sections/features.md', 'sections/data.md', 'sections/history.md']);
  });

  it('the system-findings section needs the map stage file, then the system file, read before the features and the data, and adds nothing to the others', () => {
    expect(readPlan(['system-findings'])).toEqual(['stages/map.md', 'sections/system.md']);
    expect(readPlan(['findings', 'system-findings'])).toEqual(['stages/map.md', 'sections/system.md', 'sections/features.md']);
    expect(readPlan(['data', 'system-findings'])).toEqual(['stages/map.md', 'sections/system.md', 'sections/data.md']);
    expect(readPlan(['features', 'data', 'findings'])).not.toContain('sections/system.md');
  });

  it('the findings section needs the map stage file, then the features file (the lane of a feature writes its findings), and adds nothing to the others', () => {
    expect(readPlan(['findings'])).toEqual(['stages/map.md', 'sections/features.md']);
    expect(readPlan(['data', 'findings'])).toEqual(['stages/map.md', 'sections/features.md', 'sections/data.md']);
    expect(readPlan(['features', 'findings'])).toEqual(['stages/map.md', 'sections/features.md']);
    expect(readPlan(['overview', 'data'])).not.toContain('sections/features.md');
  });

  it('the data section needs no stage file: its own file only, whatever else is chosen', () => {
    expect(readPlan(['data'])).toEqual(['sections/data.md']);
    expect(readPlan(['overview', 'data'])).toEqual(['stages/map.md', 'sections/system.md', 'sections/data.md']);
  });

  it('a section needs the map stage file, then its own file', () => {
    expect(readPlan(['overview'])).toEqual(['stages/map.md', 'sections/system.md']);
    expect(readPlan(['features'])).toEqual(['stages/map.md', 'sections/features.md']);
  });
});

describe('the priority section (handbook-findings-priority, design D1)', () => {
  it('has no READ file and no stage file: the readPlan of every list leaves it out, and the map stage file is not read for it', () => {
    expect(readPlan(['priority'])).toEqual([]);
    expect(readPlan(['findings', 'priority'])).toEqual(['stages/map.md', 'sections/features.md']);
    expect(readPlan(['data', 'priority'])).toEqual(['sections/data.md']);
    expect(readPlan([...DEFAULT_SECTIONS])).not.toContain('sections/priority.md');
  });

  it('is the one AFTER_TRACE file of a run that selects it, and of no other', () => {
    expect(afterTracePlan(['priority'])).toEqual(['sections/priority.md']);
    expect(afterTracePlan([...DEFAULT_SECTIONS])).toEqual(['sections/priority.md', 'sections/remedies.md', 'sections/topics.md', 'stages/outline.md']);
    expect(afterTracePlan(['overview', 'features', 'data', 'findings', 'system-findings'])).toEqual([]);
  });

  it('is last in the fixed order, after system-findings, whatever order the list is written in', () => {
    expect(parseSections('priority,overview').sections).toEqual(['overview', 'priority']);
    expect(SECTIONS.at(-4)).toBe('priority');
    expect(SECTIONS.indexOf('priority')).toBeGreaterThan(SECTIONS.indexOf('system-findings'));
  });

  it('is printed by handbook.mjs sections as an AFTER_TRACE line and not as a READ line', () => {
    const only = runHandbook(['sections', 'priority']);
    expect(only.status, only.stderr).toBe(0);
    expect(only.lines).toEqual(['SECTIONS=priority', 'AFTER_TRACE=sections/priority.md']);
    expect(runHandbook(['sections', 'findings,priority']).lines).toEqual(['SECTIONS=findings,priority', 'READ=stages/map.md', 'READ=sections/features.md', 'AFTER_TRACE=sections/priority.md']);
    for (const list of ['priority', 'overview,priority', '']) expect(runHandbook(['sections', list]).lines.filter((line) => line === 'READ=sections/priority.md')).toEqual([]);
    expect(runHandbook(['sections', 'overview']).lines.some((line) => line.startsWith('AFTER_TRACE='))).toBe(false);
  });
});

// O1 of openspec change handbook-remedies, design D1: the remedies section is read after the trace too, after the priority one.
describe('the remedies section (handbook-remedies, design D1)', () => {
  it('has no READ file and no stage file, and is the third to last section in the fixed order', () => {
    expect(readPlan(['remedies'])).toEqual([]);
    expect(readPlan(['findings', 'remedies'])).toEqual(['stages/map.md', 'sections/features.md']);
    expect(readPlan([...DEFAULT_SECTIONS])).not.toContain('sections/remedies.md');
    expect(SECTIONS.at(-3)).toBe('remedies');
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

// O1 of openspec change handbook-history-appendix, design D1: the history section is a script section like data: no map, no
// stage file, no subagent; its file is read at the moment the run reaches it, right after the data file.
describe('the history section (handbook-history-appendix, design D1)', () => {
  it('needs no stage file: its own file only, whatever else is chosen, and it adds nothing to the other sections', () => {
    expect(readPlan(['history'])).toEqual(['sections/history.md']);
    expect(readPlan(['overview', 'history'])).toEqual(['stages/map.md', 'sections/system.md', 'sections/history.md']);
    expect(readPlan(['data', 'history'])).toEqual(['sections/data.md', 'sections/history.md']);
    expect(readPlan(['history', 'findings'])).toEqual(['stages/map.md', 'sections/features.md', 'sections/history.md']);
    expect(afterTracePlan(['history'])).toEqual([]);
    expect(readPlan(['overview', 'features', 'data', 'findings'])).not.toContain('sections/history.md');
  });

  it('comes right after data in the fixed order, whatever order the list is written in', () => {
    expect(SECTIONS.indexOf('history')).toBe(SECTIONS.indexOf('data') + 1);
    expect(parseSections('findings,history,overview').sections).toEqual(['overview', 'history', 'findings']);
  });

  it('is printed by handbook.mjs sections as one READ line and nothing else', () => {
    const only = runHandbook(['sections', 'history']);
    expect(only.status, only.stderr).toBe(0);
    expect(only.lines).toEqual(['SECTIONS=history', 'READ=sections/history.md']);
    expect(runHandbook(['sections', 'data,history']).lines).toEqual(['SECTIONS=data,history', 'READ=sections/data.md', 'READ=sections/history.md']);
  });

  it('is in the allowed values the usage line names', () => {
    expect(parseSections('tables').lines[1]).toContain('overview, features, data, history, architecture, findings');
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
    expect(runHandbook(['sections', 'overview']).lines).toEqual(['SECTIONS=overview', 'READ=stages/map.md', 'READ=sections/system.md']);
    expect(runHandbook(['sections', 'features']).lines).toEqual(['SECTIONS=features', 'READ=stages/map.md', 'READ=sections/features.md']);
  });

  it('prints the map stage file and the features file for the findings section, and only those', () => {
    const result = runHandbook(['sections', 'findings']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual(['SECTIONS=findings', 'READ=stages/map.md', 'READ=sections/features.md']);
  });

  it('prints the map stage file and the system file for the system-findings section, and only those', () => {
    const result = runHandbook(['sections', 'system-findings']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual(['SECTIONS=system-findings', 'READ=stages/map.md', 'READ=sections/system.md']);
  });

  it('prints only the data file for the data section: no map stage file', () => {
    const result = runHandbook(['sections', 'data']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual(['SECTIONS=data', 'READ=sections/data.md']);
    expect(runHandbook(['sections', 'overview,data']).lines).toEqual(['SECTIONS=overview,data', 'READ=stages/map.md', 'READ=sections/system.md', 'READ=sections/data.md']);
  });

  it('prints the map stage file once when both sections are chosen', () => {
    const result = runHandbook(['sections', 'overview,features']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual(['SECTIONS=overview,features', 'READ=stages/map.md', 'READ=sections/system.md', 'READ=sections/features.md']);
    expect(result.lines.filter((line) => line === 'READ=stages/map.md')).toHaveLength(1);
  });

  it('prints the same lines in the same order whatever order the list is written in', () => {
    expect(runHandbook(['sections', 'outline,topics,remedies,priority,system-findings,findings,architecture,history,data,features,overview']).lines).toEqual(ALL);
    expect(runHandbook(['sections', 'features,data,outline,topics,remedies,priority,system-findings,findings,architecture,history,overview,features']).lines).toEqual(ALL);
  });

  it('exits 1 and prints the allowed values for a value that is not a section, printing no READ line', () => {
    const result = runHandbook(['sections', 'tables,overview']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain('"tables"');
    expect(result.stdout).toContain('--sections takes overview, features, data, history, architecture, findings, system-findings, priority, remedies, topics, outline, any of them separated by a comma (default: all)');
    expect(result.lines.some((line) => line.startsWith('READ='))).toBe(false);
  });

  it('takes one list at most and no option', () => {
    expect(runHandbook(['sections', 'overview', 'features']).status).toBe(2);
    expect(runHandbook(['sections', '--sections', 'overview']).status).toBe(2);
  });
});

// O1 of openspec change handbook-topics, design D1: the topics section is read after the trace too, after the remedies one.
describe('the topics section (handbook-topics, design D1)', () => {
  it('has no READ file and no stage file, and is the second to last section in the fixed order', () => {
    expect(readPlan(['topics'])).toEqual([]);
    expect(readPlan(['findings', 'topics'])).toEqual(['stages/map.md', 'sections/features.md']);
    expect(readPlan([...DEFAULT_SECTIONS])).not.toContain('sections/topics.md');
    expect(SECTIONS.at(-2)).toBe('topics');
    expect(parseSections('topics,remedies,overview').sections).toEqual(['overview', 'remedies', 'topics']);
  });

  it('is an AFTER_TRACE file, printed after the remedies one, and alone when only it is selected', () => {
    expect(afterTracePlan(['topics'])).toEqual(['sections/topics.md']);
    expect(afterTracePlan(['remedies', 'topics'])).toEqual(['sections/remedies.md', 'sections/topics.md']);
    expect(runHandbook(['sections', 'topics']).lines).toEqual(['SECTIONS=topics', 'AFTER_TRACE=sections/topics.md']);
    expect(runHandbook(['sections', 'topics,priority,remedies']).lines).toEqual(['SECTIONS=priority,remedies,topics', 'AFTER_TRACE=sections/priority.md', 'AFTER_TRACE=sections/remedies.md', 'AFTER_TRACE=sections/topics.md']);
    for (const list of ['topics', 'remedies,topics', '']) expect(runHandbook(['sections', list]).lines.filter((line) => line === 'READ=sections/topics.md')).toEqual([]);
  });
});

// O4 of openspec change handbook-outline: the outline phase is read after the trace too, after the topics one, from its stage file.
describe('the outline section (handbook-outline, task 4.1)', () => {
  it('has no READ file and no stage file, and is the last section in the fixed order', () => {
    expect(readPlan(['outline'])).toEqual([]);
    expect(readPlan(['findings', 'outline'])).toEqual(['stages/map.md', 'sections/features.md']);
    expect(readPlan([...DEFAULT_SECTIONS])).not.toContain('stages/outline.md');
    expect(SECTIONS.at(-1)).toBe('outline');
    expect(parseSections('outline,topics,overview').sections).toEqual(['overview', 'topics', 'outline']);
  });

  it('is an AFTER_TRACE file, printed after the topics one, and alone when only it is selected', () => {
    expect(afterTracePlan(['outline'])).toEqual(['stages/outline.md']);
    expect(afterTracePlan(['topics', 'outline'])).toEqual(['sections/topics.md', 'stages/outline.md']);
    expect(runHandbook(['sections', 'outline']).lines).toEqual(['SECTIONS=outline', 'AFTER_TRACE=stages/outline.md']);
    expect(runHandbook(['sections', 'outline,topics']).lines).toEqual(['SECTIONS=topics,outline', 'AFTER_TRACE=sections/topics.md', 'AFTER_TRACE=stages/outline.md']);
    for (const list of ['outline', 'topics,outline', '']) expect(runHandbook(['sections', list]).lines.filter((line) => line === 'READ=stages/outline.md')).toEqual([]);
  });
});

// O2 of openspec change handbook-one-read: the code is read once for the system and once for each feature, so the system file is read
// once for any combination of the overview, the architecture and the system findings, where the overview is read (before the features),
// and the findings add no file of their own.
describe('one read for the system and one for each feature (handbook-one-read, design D1 and D2)', () => {
  const SYSTEM = ['overview', 'architecture', 'system-findings'];
  const combinations = [];
  for (let mask = 1; mask < 8; mask += 1) combinations.push(SYSTEM.filter((_, i) => (mask >> i) & 1));

  it('reads sections/system.md exactly once for every non-empty combination of overview, architecture and system-findings', () => {
    for (const list of combinations) {
      const plan = readPlan(list);
      expect(plan, list.join()).toEqual(['stages/map.md', 'sections/system.md']);
      expect(runHandbook(['sections', list.join(',')]).lines, list.join()).toEqual([`SECTIONS=${list.join(',')}`, 'READ=stages/map.md', 'READ=sections/system.md']);
    }
  });

  it('reads the system file before the features file and before every other file, whatever else is selected', () => {
    for (const list of combinations) {
      for (const other of ['features', 'findings', 'data', 'history']) {
        const plan = readPlan([...list, other]);
        expect(plan.filter((file) => file === 'sections/system.md'), `${list.join()} ${other}`).toHaveLength(1);
        expect(plan.indexOf('sections/system.md'), `${list.join()} ${other}`).toBe(1);
      }
    }
  });

  it('reads sections/features.md once for features, findings or both, and no file of the retired findings or system phases', () => {
    for (const list of [['features'], ['findings'], ['features', 'findings']]) expect(readPlan(list).filter((file) => file === 'sections/features.md')).toHaveLength(1);
    const all = runHandbook(['sections']).lines;
    expect(all.filter((line) => line === 'READ=sections/system.md')).toHaveLength(1);
    expect(all.filter((line) => line === 'READ=sections/features.md')).toHaveLength(1);
    for (const gone of ['overview', 'architecture', 'findings', 'system-findings']) expect(all).not.toContain(`READ=sections/${gone}.md`);
    expect(all.indexOf('READ=sections/system.md')).toBeLessThan(all.indexOf('READ=sections/features.md'));
  });

  it('keeps the section ids and the default list', () => {
    expect(SECTIONS).toEqual(['overview', 'features', 'data', 'history', 'architecture', 'findings', 'system-findings', 'priority', 'remedies', 'topics', 'outline']);
    expect(DEFAULT_SECTIONS).toEqual(SECTIONS);
  });
});
