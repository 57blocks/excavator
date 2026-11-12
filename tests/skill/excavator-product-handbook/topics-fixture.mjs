/**
 * The run the topics tests share (openspec change handbook-topics): the summary
 * fixture's verified entries for F1 (domain D1, with one notification) and F3
 * (domain D2, with one automatic item), plus the verified findings of F1 and F3
 * (four groups, so the repeated lane has facts), and helpers that write the
 * part file of a lane and the verdict files of its two judges. Every sentence
 * is about the fixture's own code.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect } from 'vitest';

import { settleDerived, verifyChecked } from './helpers.mjs';
import { unitId, withFindingsHelpers } from './findings-fixture.mjs';
import { verifiedRun } from './summary-fixture.mjs';

export const PART_FORMAT = 'excavator-product-handbook-topics-part/1';

/** A run whose F1 and F3 entries are verified, with the good domains file and (unless `findings` is false) the findings of F1 and F3 verified. */
export function topicsRun(cleanups, { findings = true, withJob = true } = {}) {
  const run = verifiedRun(cleanups, { withJob });
  run.writeDomains();
  withFindingsHelpers(run);
  if (findings) {
    for (const featureId of withJob ? ['F1', 'F3'] : ['F1']) {
      run.writeFindings(featureId);
      const checked = run.run('check-findings', unitId(featureId));
      expect(checked.status, checked.stdout + checked.stderr).toBe(0);
      verifyChecked(run, unitId(featureId));
    }
  }
  return withTopicsHelpers(run);
}

/** The fact lines `topic-facts` prints for a lane (not its `domain:` lines), each split into its tab-separated fields. */
export function factRows(run, lane) {
  const result = run.run('topic-facts', '--lane', lane);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.lines.filter((line) => !line.startsWith('domain:')).map((line) => line.split('\t'));
}

export function withTopicsHelpers(run) {
  run.readState = () => run.readJson('state.json');
  run.partPath = (lane) => join(run.out, 'topics', `part-${lane}.json`);
  run.laneRun = (command, lane, ...args) => run.run(command, '--lane', lane, ...args);
  /** Write the part file of a lane as it is: `doc` is the whole file. */
  run.writeRawPart = (lane, doc) => {
    mkdirSync(dirname(run.partPath(lane)), { recursive: true });
    run.writeJson(run.partPath(lane), doc);
  };
  run.writePart = (lane, rows, extra = {}) => run.writeRawPart(lane, { schema: PART_FORMAT, lane, rows, ...extra });
  /** The group key of the group of a category (one group each in this fixture). */
  run.groupOf = (category) => factRows(run, 'repeated').find((row) => row[2] === category)[0];
  /** The good rows of a lane; all of them pass check-topics. */
  run.goodRows = (lane) => {
    if (lane === 'D1') {
      return [
        { topic: 'approval', fields: { business: 'Place an order', route: 'The clerk fills in the customer name.', skips: '', conditions: 'The item count is limited to 35000.', actors: 'Clerk' }, cites: ['F1#operations[0].sentences[0]', 'F1#operations[0].sentences[1]', 'F1#who[0]'] },
        { topic: 'access', fields: { feature: 'F1', who: 'Clerk', pageCheck: '', serverCheck: '' }, cites: ['F1#who[0]'] },
      ];
    }
    if (lane === 'D2') {
      return [
        { topic: 'time', fields: { rule: 'A reminder goes out every day at nine.', calendar: '', scope: 'Reminders' }, cites: ['F3#automatic[0]'] },
        { topic: 'handoffs', fields: { from: 'D1', to: 'D2', content: 'The order was sent.' }, cites: ['F3#states[1]'] },
      ];
    }
    return [
      { topic: 'repeated', fields: { mechanism: 'Operations on orders answer success without reading or storing anything.', places: 'Orders' }, cites: [run.groupOf('authorization'), run.groupOf('error-handling')] },
    ];
  };
  return run;
}

/** Mark the lane dispatched, write its good rows (changed by `edit`, which may return a new list) and run check-topics for it: the lane ends `checked`. */
export function checkedLane(run, lane, edit = () => undefined) {
  expect(run.run('mark', `topics:${lane}`, 'dispatched').status).toBe(0);
  const rows = run.goodRows(lane);
  run.writePart(lane, edit(rows) ?? rows);
  const result = run.laneRun('check-topics', lane);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return run;
}

/** A run with every lane written and checked. */
export function checkedTopicsRun(cleanups, options) {
  const run = topicsRun(cleanups, options);
  for (const lane of ['D1', 'D2', 'repeated']) checkedLane(run, lane);
  return run;
}

/** Settle every checked lane as an older run's two judges left it: no row dropped. */
export function judgeTopics(run) {
  return settleDerived(run, 'topics');
}
