// Oracle O1 (sections half) of openspec change handbook-architecture-chapter: the section `architecture` has its phase in
// the system file (handbook-one-read: shared with the overview and the system findings), needs the map stage (its check reads the run's language and state from it), and is part of the default list.
import { describe, expect, it } from 'vitest';

import { SECTIONS, afterTracePlan, parseSections, readPlan } from '../../../skills/excavator-product-handbook/lib/sections.mjs';
import { runHandbook } from './helpers.mjs';

describe('the architecture section', () => {
  it('is a section, after the data and the history, before the findings', () => {
    expect(SECTIONS.indexOf('architecture')).toBeGreaterThan(SECTIONS.indexOf('history'));
    expect(SECTIONS.indexOf('architecture')).toBeLessThan(SECTIONS.indexOf('findings'));
    expect(parseSections('architecture')).toEqual({ ok: true, sections: ['architecture'] });
  });

  it('reads the map stage and its own file, whatever else is chosen, and is no after-trace section', () => {
    expect(readPlan(['architecture'])).toEqual(['stages/map.md', 'sections/system.md']);
    expect(readPlan(['overview', 'architecture'])).toEqual(['stages/map.md', 'sections/system.md']);
    expect(afterTracePlan(['architecture'])).toEqual([]);
  });

  it('prints READ=sections/system.md for the command, alone and in the default list', () => {
    expect(runHandbook(['sections', 'architecture']).lines).toEqual(['SECTIONS=architecture', 'READ=stages/map.md', 'READ=sections/system.md']);
    expect(runHandbook(['sections']).lines).toContain('READ=sections/system.md');
  });
});
