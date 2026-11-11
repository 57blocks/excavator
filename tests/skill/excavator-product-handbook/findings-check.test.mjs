// O1 (shape and checks) of openspec change handbook-feature-findings: the shape
// of a findings file, the category enum, the unit id, the state key, an empty
// list that is verified at once, and one counter-example for each check
// (citation, number, banned word, advice word, language).
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FINDING_CATEGORIES, categoryKey, findingsShapeProblems } from '../../../skills/excavator-product-handbook/lib/findings-shape.mjs';
import { MARK, clone, makeRun, markedMap, set, translatedUi } from './helpers.mjs';
import { FINDINGS_FORMAT, ORDERS_FILE, checkedFindingsRun, findingsRun, goodFindings, unitId, withFindingsHelpers } from './findings-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const stateOf = (run) => run.readState();
const entryFile = (run, id) => join(run.out, 'entries', `${id}.json`);

describe('the shape of a findings file', () => {
  it('accepts the good file and a file with no finding', () => {
    expect(findingsShapeProblems(goodFindings('F1'))).toEqual([]);
    expect(findingsShapeProblems({ ...goodFindings('F1'), findings: [], unknowns: [] })).toEqual([]);
  });

  it('has the eleven categories of the design in a fixed order', () => {
    expect(FINDING_CATEGORIES).toEqual(['authorization', 'error-handling', 'notification', 'consistency', 'calculation', 'hard-coded', 'contract', 'security', 'display', 'time', 'other']);
  });

  it('refuses a category that is not in the enum, a missing or extra key, a wrong format and a finding without evidence', () => {
    const bad = (adjust) => findingsShapeProblems(adjust(clone(goodFindings('F1'))));
    expect(bad((doc) => set(doc, 'findings.0.category', 'style'))[0]).toBe(`findings[0].category: must be one of ${FINDING_CATEGORIES.join(', ')}, found "style"`);
    expect(bad((doc) => { delete doc.unknowns; return doc; })).toEqual(['(top level): missing key "unknowns"']);
    expect(bad((doc) => set(doc, 'extra', 1))).toEqual(['(top level): unexpected key "extra"']);
    expect(bad((doc) => set(doc, 'format', 'excavator-product-handbook-findings/2'))[0]).toContain('format: must be');
    expect(bad((doc) => set(doc, 'findings.1.evidence', []))).toEqual(['findings[1].evidence: must have at least 1 item']);
    expect(bad((doc) => set(doc, 'findings.0.text', ''))[0]).toContain('findings[0].text: must be a non-empty string');
  });
});

describe('check-findings and try-findings', () => {
  it('records checked under state.findings and leaves the feature state alone; try-findings records nothing', () => {
    const run = findingsRun(cleanups);
    run.writeFindings('F1');
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    expect(JSON.parse(before).findings).toBeUndefined();
    const tried = run.run('try-findings', unitId('F1'));
    expect(tried.lines).toEqual(['F1.findings: ok']);
    expect(tried.status).toBe(0);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
    const result = run.run('check-findings', unitId('F1'));
    expect(result.lines).toEqual(['F1.findings: checked']);
    expect(result.status).toBe(0);
    expect(stateOf(run).findings).toEqual({ F1: { status: 'checked', attempts: 0 } });
    expect(stateOf(run).features.F1).toEqual({ status: 'planned', attempts: 0 });
  });

  it('reads a state without the findings key as planned with no attempt, so an old output directory needs no migration', () => {
    const run = findingsRun(cleanups);
    expect(stateOf(run).findings).toBeUndefined();
    const marked = run.run('mark', unitId('F2'), 'dispatched');
    expect(marked.lines).toEqual(['F2.findings: dispatched, attempts 1']);
    expect(stateOf(run).findings).toEqual({ F2: { status: 'dispatched', attempts: 1 } });
    expect(stateOf(run).features.F2).toEqual({ status: 'planned', attempts: 0 });
  });

  it('records a lane that wrote nothing as failed at lane, with the Next line of an entry', () => {
    const run = findingsRun(cleanups);
    expect(run.run('mark', unitId('F1'), 'dispatched').status).toBe(0);
    const result = run.run('check-findings', unitId('F1'));
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('F1.findings: lane-wrote-nothing: entries/F1.findings.json is missing');
    expect(result.lines.at(-1)).toMatch(/^Next: delete F1\.findings's entry, mark it dispatched and re-dispatch it once/);
    expect(stateOf(run).findings.F1).toMatchObject({ status: 'failed', attempts: 1, failure: { step: 'lane' } });
  });

  it('takes the id of a findings unit of a feature in the map, and nothing else', () => {
    const run = findingsRun(cleanups);
    run.writeFindings('F1');
    expect(run.run('check-findings', 'F9.findings').status).toBe(2);
    expect(run.run('check-findings', 'F1').status).toBe(2);
    expect(run.run('check-findings', 'overview').status).toBe(2);
    expect(run.run('try-findings', 'F9.findings').status).toBe(2);
    expect(run.run('mark', 'F9.findings', 'dispatched').status).toBe(2);
    expect(stateOf(run).findings).toBeUndefined();
  });

  it('refuses a file whose id is not the unit it is checked as', () => {
    const run = findingsRun(cleanups);
    run.writeFindings('F1', set(run.findingsDoc('F1'), 'id', 'F2.findings'));
    const result = run.run('check-findings', unitId('F1'));
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('id: "F2.findings" is not "F1.findings", the feature this entry is checked as');
  });

  it('records an empty list as verified at once with no items, and keeps its digest so the handbook accepts it', () => {
    const run = findingsRun(cleanups);
    run.writeFindings('F2', { ...goodFindings('F2'), findings: [], unknowns: [] });
    const result = run.run('check-findings', unitId('F2'));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['F2.findings: verified (0 findings)']);
    const record = stateOf(run).findings.F2;
    expect(record).toMatchObject({ status: 'verified', attempts: 0 });
    expect(typeof record.entryDigest).toBe('string');
    // Nothing to prove: the verification steps have nothing to do with it.
    const slices = run.run('slices', unitId('F2'));
    expect(slices.status).toBe(1);
    expect(slices.lines[0]).toBe('F2.findings: is verified; only a checked feature is verified');
    // A second check of the same file stays as it is.
    expect(run.run('check-findings', unitId('F2')).lines).toEqual(['F2.findings: verified, unchanged since it was verified']);
  });

  it('an empty list that still has an unknown is verified too, and a bad file is never verified by being short', () => {
    const run = findingsRun(cleanups);
    run.writeFindings('F2', { ...goodFindings('F2'), findings: [], unknowns: [{ item: 'Whether anything checks the caller', searched: 'the route files' }] });
    expect(run.run('check-findings', unitId('F2')).status).toBe(0);
    expect(stateOf(run).findings.F2.status).toBe('verified');
    run.writeFindings('F3', { ...goodFindings('F3'), findings: [], unknowns: [{ item: 'a_b', searched: 'x' }] });
    const bad = run.run('check-findings', unitId('F3'));
    expect(bad.status).toBe(1);
    expect(stateOf(run).findings.F3.status).toBe('failed');
  });
});

describe('each check has a counter-example', () => {
  const failing = (adjust) => {
    const run = findingsRun(cleanups);
    run.writeFindings('F1', adjust(run.findingsDoc('F1')));
    const result = run.run('check-findings', unitId('F1'));
    expect(result.status, result.stdout).toBe(1);
    expect(stateOf(run).findings.F1.status).toBe('failed');
    return result.lines;
  };

  it('a passage that is not in its file', () => {
    expect(failing((doc) => set(doc, 'findings.0.evidence.0.passage', 'router.delete("/:id", approve);'))).toContain(`findings[0].evidence[0]: passage not in ${ORDERS_FILE}`);
  });

  it('a cited file that is not project source', () => {
    expect(failing((doc) => set(doc, 'findings.0.evidence.0.file', 'src/nothing.js')).some((line) => line.startsWith('findings[0].evidence[0]: src/nothing.js'))).toBe(true);
  });

  it('a number the quoted passage does not hold, and one it holds', () => {
    expect(failing((doc) => set(doc, 'findings.1.text', 'Creating an order answers with the number 999 whatever happens.'))).toContain(`findings[1].text: number 999 does not occur in this item's passages (${ORDERS_FILE})`);
    const run = findingsRun(cleanups);
    run.writeFindings('F1', set(run.findingsDoc('F1'), 'findings.1.text', 'Creating an order always answers 201 without storing anything.'));
    expect(run.run('check-findings', unitId('F1')).status).toBe(0);
  });

  it('a code-shaped word in the text, in an unknown too', () => {
    expect(failing((doc) => set(doc, 'findings.0.text', 'The delete handler never reads max_upload.'))).toContain('findings[0].text: "max_upload" is not allowed in reader text (underscore identifier); write it in plain words');
    expect(failing((doc) => set(doc, 'unknowns.0.searched', 'the file orders.js'))).toContain('unknowns[0].searched: "orders.js" is not allowed in reader text (source file extension); write it in plain words');
  });

  it('an advice word in the text, named in the line; the unknowns and a longer word are not read as advice', () => {
    const lines = failing((doc) => set(doc, 'findings.0.text', 'Deleting an order checks nothing about the caller, so it Should check the role.'));
    expect(lines).toContain('findings[0].text: "should" is a word of advice; write the defect and when it happens, not what to change');
    const run = findingsRun(cleanups);
    run.writeFindings('F1', set(set(run.findingsDoc('F1'), 'findings.0.text', 'Deleting an order checks nothing about the caller; the answer is the same for a shoulder-high stack.'), 'unknowns.0.item', 'Whether the code should check a role'));
    expect(run.run('check-findings', unitId('F1')).status).toBe(0);
  });

  it('a category that is not in the enum is a shape problem', () => {
    expect(failing((doc) => set(doc, 'findings.2.category', 'style'))[0]).toContain('findings[2].category: must be one of');
  });

  it('does not write the file of a finding that failed a check anywhere but the lane: the file stays as written', () => {
    const run = findingsRun(cleanups);
    const doc = set(run.findingsDoc('F1'), 'findings.0.text', 'It should check the role.');
    run.writeFindings('F1', doc);
    expect(run.run('check-findings', unitId('F1')).status).toBe(1);
    expect(JSON.parse(readFileSync(entryFile(run, unitId('F1')), 'utf-8'))).toEqual(doc);
  });
});

describe('the advice words come from the run\'s fixed-text table', () => {
  const CJK_ADVICE = String.fromCodePoint(0x5e94, 0x8be5);
  const ui = () => {
    const table = translatedUi('Chinese');
    table.strings['md.findings.adviceWords'] = `${CJK_ADVICE},${MARK}fix`;
    return table;
  };

  function chineseRun() {
    const run = withFindingsHelpers(makeRun());
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), ui());
    run.writeMap(markedMap(run.map, 'Chinese'));
    expect(run.run('check-map').status).toBe(0);
    return run;
  }

  const doc = (text) => {
    const made = goodFindings('F3');
    made.findings[0].text = text;
    return made;
  };

  it('matches a word that is not written in ASCII letters as a substring', () => {
    const run = chineseRun();
    run.writeFindings('F3', doc(`${MARK}x${CJK_ADVICE}y`));
    const bad = run.run('check-findings', unitId('F3'));
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.lines).toContain(`findings[0].text: "${CJK_ADVICE}" is a word of advice; write the defect and when it happens, not what to change`);
    run.writeFindings('F3', doc(`${MARK}one fixed time of day`));
    expect(run.run('check-findings', unitId('F3')).status).toBe(0);
  });

  it('does not use the English list when the run\'s table has its own', () => {
    const run = chineseRun();
    run.writeFindings('F3', doc(`${MARK}it should check`));
    const result = run.run('check-findings', unitId('F3'));
    expect(result.status, result.stdout).toBe(0);
  });

  it('checks the narrative language of the text, as an entry is checked', () => {
    const run = chineseRun();
    run.writeFindings('F3', doc('One fixed time of day for everyone.'));
    const bad = run.run('check-findings', unitId('F3'));
    expect(bad.status).toBe(1);
    expect(bad.lines).toContain(`findings[0].text: written only in ASCII letters; the run's language is Chinese; write it in that language (labels quoted from the source stay as they are)`);
  });
});

describe('the shipped fixed text of the findings', () => {
  const shipped = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;

  it('has a display name for each category and a comma-separated list of advice words', () => {
    for (const category of FINDING_CATEGORIES) expect(typeof shipped[categoryKey(category)], category).toBe('string');
    const words = shipped['md.findings.adviceWords'].split(',').map((word) => word.trim());
    expect(words.length).toBeGreaterThan(5);
    expect(words).toEqual(expect.arrayContaining(['should', 'recommend', 'fix']));
    // Rule statements use these words as descriptions (openspec change handbook-run-precision D1).
    for (const word of ['must', 'need to', 'needs to']) expect(words).not.toContain(word);
    expect(new Set(words).size).toBe(words.length);
  });

  it('has no apostrophe in a text the page shows, since the page escapes it', () => {
    // The two word lists are matched by scripts and shown nowhere, so they may hold the forms with an apostrophe (won't, can't).
    const matched = ['md.findings.adviceWords', 'md.findings.scopeWords'];
    for (const [key, value] of Object.entries(shipped)) if ((key.startsWith('md.findings.') || key.startsWith('page.findings.')) && !matched.includes(key)) expect(value, key).not.toContain("'");
  });
});

describe('the format constant', () => {
  it('is the one the files carry', () => {
    expect(goodFindings('F1').format).toBe(FINDINGS_FORMAT);
    expect(FINDINGS_FORMAT).toBe('excavator-product-handbook-findings/1');
  });
});

describe('a checked run is the starting point of the verification tests', () => {
  it('checks the good findings of F1 and F3', () => {
    const run = checkedFindingsRun(cleanups, 'F1');
    run.writeFindings('F3');
    expect(run.run('check-findings', unitId('F3')).lines).toEqual(['F3.findings: checked']);
    expect(Object.keys(stateOf(run).findings)).toEqual(['F1', 'F3']);
  });
});
