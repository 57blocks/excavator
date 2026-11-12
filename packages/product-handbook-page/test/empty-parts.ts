import type { Appendix, History } from '../src/lib/types';

/** The code health and the appendix of a page whose test does not look at them: a history file that was not written and an appendix with nothing in it. */
export const NO_HISTORY: History = { state: 'missing', noHistory: null, years: [], apps: [], hotspots: [], coChange: [], tests: [], conventions: ['goTest', 'dotTest', 'dotSpec', 'pyPrefix', 'pySuffix', 'javaTest', 'testsDir'] };

export const NO_APPENDIX: Appendix = {
  open: [],
  glossary: [],
  sources: {
    parts: (['overview', 'features', 'findings', 'system-findings'] as const).map((id) => ({ id, units: 0, verified: 0, items: 0, removedVerify: 0, removedTrace: 0, again: 0 })),
    ranked: { priority: { kept: 0, left: 0 }, remedies: { kept: 0, left: 0 }, topics: { kept: 0, left: 0 } },
  },
};
