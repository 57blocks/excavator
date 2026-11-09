// O1 (checks) of openspec change handbook-system-findings: check-system-findings
// and try-system-findings run the checks of a findings file (shape, citations,
// numbers, banned words, advice words, language) and two more, each with a
// counter-example and a passing control: a finding has a passage in the
// application, and a finding that cites only the seed files of one feature,
// none of them a seed of this unit, belongs to that feature.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MARK, markedMap, translatedUi } from './helpers.mjs';
import { MAILER, MAIL_LINE, NIGHTLY, JOB_LINE, ORDERS, REPORTS, ROUTE, SERVER, SMALL, START, STOCK, goodSystemFindings, makeSystemRun, systemId, systemRun } from './system-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ev = (file, passage) => ({ file, passage });
const UTIL = 'gamma/src/util.js';
const UTIL_LINE = 'return n * 2;';

/** A system findings file of application `n` with one finding that cites `evidence`. */
const oneFinding = (n, evidence, text = 'The answer is the same whatever happens before it.') => ({ ...goodSystemFindings(n), findings: [{ category: 'other', text, evidence }], unknowns: [] });

/** Check one file as `app<n>.system`: { status, lines } of check-system-findings, and the state record afterwards. */
function check(doc, n = 1) {
  const run = systemRun(cleanups);
  run.writeSystem(n, doc);
  const result = run.run('check-system-findings', systemId(n));
  return { ...result, record: run.readState().systemFindings?.[`app${n}`], run };
}

describe('in the application: each finding has a passage under the unit\'s root', () => {
  it('refuses a finding that cites only files outside the application, and names the application', () => {
    const { status, lines, record } = check(oneFinding(1, [ev(UTIL, UTIL_LINE)]));
    expect(status).toBe(1);
    expect(lines).toContain('findings[0].evidence: no cited file is under the application alpha; a system finding cites at least one passage in it');
    expect(lines.filter((line) => line.includes('seed file of feature'))).toEqual([]);
    expect(record.status).toBe('failed');
  });

  it('the beta route table is outside alpha: a finding of alpha that cites only it is refused for that', () => {
    const { lines } = check(oneFinding(1, [ev(STOCK, ROUTE(1))]));
    expect(lines.some((line) => line.startsWith('findings[0].evidence: no cited file is under the application alpha'))).toBe(true);
  });

  it('passes a finding with one passage in the application and one outside, and one wholly inside', () => {
    expect(check(oneFinding(1, [ev(UTIL, UTIL_LINE), ev(MAILER, MAIL_LINE)])).status).toBe(0);
    expect(check(oneFinding(1, [ev(MAILER, MAIL_LINE)])).status).toBe(0);
  });

  it('is judged finding by finding: one finding in the application does not excuse another outside it', () => {
    const doc = oneFinding(1, [ev(MAILER, MAIL_LINE)]);
    doc.findings.push({ category: 'other', text: 'The helper doubles whatever it is given.', evidence: [ev(UTIL, UTIL_LINE)] });
    const { status, lines } = check(doc);
    expect(status).toBe(1);
    expect(lines.filter((line) => line.startsWith('findings[1].evidence: no cited file is under the application'))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith('findings[0]'))).toBe(false);
  });

  it('uses the root of the unit it is checked as: the beta file is inside application 2', () => {
    expect(check(goodSystemFindings(2), 2).status).toBe(0);
    const { lines } = check(oneFinding(2, [ev(MAILER, MAIL_LINE)], 'The helper claims to send a message and sends none.'), 2);
    expect(lines.some((line) => line.startsWith('findings[0].evidence: no cited file is under the application beta'))).toBe(true);
  });
});

describe('ownership: a finding of one feature is that feature\'s', () => {
  it('refuses a finding whose every file is a seed file of one feature and of no one else, and names the feature', () => {
    const { status, lines, record } = check(oneFinding(1, [ev(ORDERS, ROUTE(1))]));
    expect(status).toBe(1);
    const line = lines.find((one) => one.startsWith('findings[0].evidence: every file this finding cites is a seed file of feature F1'));
    expect(line).toBeDefined();
    expect(line).toContain('none is a seed file of this application');
    expect(lines.some((one) => one.includes('F2'))).toBe(false);
    expect(record.status).toBe('failed');
  });

  it('names the feature that owns the cited files, not another', () => {
    const { lines } = check(oneFinding(1, [ev(REPORTS, ROUTE(1))]));
    expect(lines.some((line) => line.includes('seed file of feature F2'))).toBe(true);
    expect(lines.some((line) => line.includes('feature F1'))).toBe(false);
  });

  it('refuses it in the second application too, with that application\'s feature', () => {
    const { status, lines } = check(oneFinding(2, [ev(SMALL, ROUTE(1))], 'The small list answers with nothing whatever was stored.'), 2);
    expect(status).toBe(1);
    expect(lines.some((line) => line.includes('seed file of feature F6'))).toBe(true);
  });

  it('passes the same finding when one of its files is a seed of the unit (the route table is a seed of both)', () => {
    expect(check(oneFinding(1, [ev(ORDERS, ROUTE(1)), ev(SERVER, ROUTE(1))])).status).toBe(0);
    expect(check(oneFinding(1, [ev(SERVER, ROUTE(1))])).status).toBe(0);
    expect(check(oneFinding(1, [ev(START, '#!/usr/bin/env node')])).status).toBe(0);
    expect(check(oneFinding(1, [ev(NIGHTLY, JOB_LINE)])).status).toBe(0);
  });

  it('passes a finding that cites files of two features: it does not belong to one', () => {
    expect(check(oneFinding(1, [ev(ORDERS, ROUTE(1)), ev(REPORTS, ROUTE(1))])).status).toBe(0);
  });

  it('passes a finding that also cites a file no feature has as a seed', () => {
    expect(check(oneFinding(1, [ev(ORDERS, ROUTE(1)), ev(MAILER, MAIL_LINE)])).status).toBe(0);
  });

  it('is judged finding by finding', () => {
    const doc = goodSystemFindings(1);
    doc.findings.push({ category: 'other', text: 'The answer is the same whatever happens before it.', evidence: [ev(ORDERS, ROUTE(1))] });
    const { status, lines } = check(doc);
    expect(status).toBe(1);
    expect(lines.filter((line) => line.includes('seed file of feature'))).toEqual([expect.stringMatching(/^findings\[2\]\.evidence: /)]);
  });

  it('try-system-findings reports the same lines and records nothing', () => {
    const run = systemRun(cleanups);
    run.writeSystem(1, oneFinding(1, [ev(ORDERS, ROUTE(1))]));
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    const tried = run.run('try-system-findings', systemId(1));
    expect(tried.status).toBe(1);
    expect(tried.lines.some((line) => line.includes('seed file of feature F1'))).toBe(true);
    expect(tried.lines.at(-1)).toBe('Next: fix each line above in entries/app1.system.json and run try-system-findings again');
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
  });
});

describe('the checks of a findings file apply to a system finding', () => {
  const failing = (adjust) => {
    const doc = adjust(goodSystemFindings(1));
    const { status, lines, record } = check(doc);
    expect(status, lines.join('\n')).toBe(1);
    expect(record.status).toBe('failed');
    return lines;
  };

  it('a passage that is not in its file, and a cited file that is not project source', () => {
    expect(failing((doc) => { doc.findings[0].evidence[0].passage = 'return { to, sent: false };'; return doc; })).toContain(`findings[0].evidence[0]: passage not in ${MAILER}`);
    expect(failing((doc) => { doc.findings[0].evidence[0].file = 'alpha/src/nothing.js'; return doc; }).some((line) => line.startsWith('findings[0].evidence[0]: alpha/src/nothing.js'))).toBe(true);
  });

  it('a number the passages do not hold', () => {
    expect(failing((doc) => { doc.findings[0].text = 'The mail helper reports 999 messages as sent.'; return doc; })).toContain(`findings[0].text: number 999 does not occur in this item's passages (${MAILER})`);
  });

  it('a code-shaped word in the text', () => {
    expect(failing((doc) => { doc.findings[0].text = 'The mail helper never reads max_upload.'; return doc; })).toContain('findings[0].text: "max_upload" is not allowed in reader text (underscore identifier); write it in plain words');
  });

  it('an advice word in the text, named in the line', () => {
    expect(failing((doc) => { doc.findings[0].text = 'The mail helper should send the message.'; return doc; })).toContain('findings[0].text: "should" is a word of advice; write the defect and when it happens, not what to change');
  });

  it('a category that is not in the enum', () => {
    expect(failing((doc) => { doc.findings[0].category = 'style'; return doc; })[0]).toContain('findings[0].category: must be one of');
  });

  it('a file with another shape: a missing key', () => {
    const doc = goodSystemFindings(1);
    delete doc.unknowns;
    expect(failing(() => doc)[0]).toBe('(top level): missing key "unknowns"');
  });

  it('the narrative language of a run in another language', () => {
    const run = makeSystemRun();
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
    run.writeJson(join(run.out, 'map.json'), markedMap(run.map, 'Chinese'));
    expect(run.run('check-map').status).toBe(0);
    const doc = goodSystemFindings(1);
    run.writeSystem(1, doc);
    const bad = run.run('check-system-findings', systemId(1));
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.lines).toContain('findings[0].text: written only in ASCII letters; the run\'s language is Chinese; write it in that language (labels quoted from the source stay as they are)');
    doc.findings.forEach((finding) => { finding.text = `${MARK}${finding.text}`; });
    doc.unknowns.forEach((unknown) => { unknown.item = `${MARK}${unknown.item}`; unknown.searched = `${MARK}${unknown.searched}`; });
    run.writeSystem(1, doc);
    expect(run.run('check-system-findings', systemId(1)).status).toBe(0);
  });

  it('the good file of each application passes every check', () => {
    expect(check(goodSystemFindings(1), 1).status).toBe(0);
    expect(check(goodSystemFindings(2), 2).status).toBe(0);
  });
});
