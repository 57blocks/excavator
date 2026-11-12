// O1 (unit) of openspec change handbook-feature-findings: mark runs on the unit id `<feature>.findings`; the state is
// kept under `state.findings`; a verified unit is the file that was verified.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { clone, verifyChecked } from './helpers.mjs';
import { checkedFindingsRun, unitId } from './findings-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ID = unitId('F1');
const stateOf = (run) => run.readState().findings.F1;

describe('a findings unit', () => {
  it('a verified unit is the file that was verified: a changed file starts over as checked', () => {
    const run = checkedFindingsRun(cleanups);
    verifyChecked(run, ID);
    expect(stateOf(run).status).toBe('verified');
    const doc = clone(run.readFindings('F1'));
    doc.findings[0].text = 'Deleting an order answers success to every caller.';
    run.writeFindings('F1', doc);
    expect(run.run('check-findings', ID).lines).toEqual(['F1.findings: checked']);
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0 });
  });

  it('refuses a third dispatch and a dispatch of a unit that is already checked', () => {
    const run = checkedFindingsRun(cleanups);
    expect(run.run('mark', ID, 'dispatched').lines).toEqual(['F1.findings: already checked; it is not written again']);
    const other = checkedFindingsRun(cleanups, 'F3');
    expect(other.run('mark', 'F1.findings', 'dispatched').status).toBe(0);
    expect(other.run('mark', 'F1.findings', 'failed', 'lane', 'wrote nothing').status).toBe(0);
    expect(other.run('mark', 'F1.findings', 'dispatched').status).toBe(0);
    expect(other.run('mark', 'F1.findings', 'dispatched').lines[0]).toBe('F1.findings: attempts is already 2, the most a lane gets');
    expect(existsSync(join(other.out, 'entries', 'F1.findings.json'))).toBe(false);
  });
});
