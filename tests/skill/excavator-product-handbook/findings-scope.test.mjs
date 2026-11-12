// O1 of openspec change handbook-feature-findings, design D9 (the trace of the
// scope words): the trace file of a findings unit gives each finding the scope
// words its statement holds; a tracer that judges such a finding `holds` must
// write one case and its result for each word, and `trace-verdicts` refuses a
// missing, extra or repeated word and an empty or multi-line case or result.
// Entry and overview trace files never carry the key. Every refusal is paired
// with a control that passes.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as findingsCheck from '../../../skills/excavator-product-handbook/lib/findings-check.mjs';
import { MARK, clone, confirmChecked, judge, makeCheckedMapRun, makeRun, markedMap, traceFeature, translatedUi } from './helpers.mjs';
import { checkedFindingsRun, goodFindings, unitId, withFindingsHelpers } from './findings-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ID = unitId('F1');
const AT = { file: 'src/app.js', line: 6 };
const WORDS = 'all,every,each,any,always,never,none,nobody,no one,only,whenever,whatever,every time,will not,won\'t,cannot,can\'t,does not,doesn\'t,instead of,rather than';
const CJK_SCOPE = String.fromCodePoint(0x6240, 0x6709);
const readTrace = (run, id = ID) => JSON.parse(readFileSync(join(run.out, 'trace', id, 'part-1.json'), 'utf-8'));
const stateOf = (run) => run.readState().findings.F1;

/** F1 findings checked and confirmed by both verifiers: ready to be traced. Its statements hold: finding 0 "every", finding 1 no scope word, finding 2 "always" and "whatever". */
function confirmedRun() {
  const run = checkedFindingsRun(cleanups);
  judge(run, ID);
  return run;
}

/** Trace the unit; both tracers hold every item, and `edit` changes the verdict list of tracer a of the part. */
const traceWith = (run, edit) => traceFeature(run, ID, () => 'holds', edit);
const verdictOf = (verdicts, path) => verdicts.find((entry) => entry.id === path);

describe('the scope words of the run\'s table', () => {
  it('ships md.findings.scopeWords as a comma-separated list of English words', () => {
    const shipped = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
    expect(shipped['md.findings.scopeWords']).toBe(WORDS);
    expect(findingsCheck.scopeWordsOf(shipped)).toEqual(WORDS.split(','));
  });

  it('matches a word written only in ASCII as a whole word ignoring case, a word of another script as a substring', () => {
    const words = ['all', 'every', 'no one', CJK_SCOPE];
    expect(findingsCheck.wordsIn('Overall the shipment is small, and a ball is not all.', words)).toEqual(['all']);
    expect(findingsCheck.wordsIn('Overall, every ball bounces.', words)).toEqual(['every']);
    expect(findingsCheck.wordsIn('ALL of it, and No One cares.', words)).toEqual(['all', 'no one']);
    expect(findingsCheck.wordsIn('Nothing about it.', ['no one', 'none'])).toEqual([]);
    expect(findingsCheck.wordsIn(`${MARK}x${CJK_SCOPE}y`, words)).toEqual([CJK_SCOPE]);
  });

  it('lists the words in the order of the table, each once', () => {
    expect(findingsCheck.wordsIn('Always, whatever happens, always and every one.', ['every', 'always', 'whatever'])).toEqual(['every', 'always', 'whatever']);
  });
});

describe('negative and contrasting words are scope words too (design D10 of handbook-system-findings)', () => {
  const NEW_WORDS = ['will not', "won't", 'cannot', "can't", 'does not', "doesn't", 'instead of', 'rather than'];
  const shipped = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
  const table = findingsCheck.scopeWordsOf(shipped);

  it('the shipped table holds them, after the earlier words and in this order', () => {
    expect(table.slice(-NEW_WORDS.length)).toEqual(NEW_WORDS);
    expect(table.slice(0, 13)).toEqual('all,every,each,any,always,never,none,nobody,no one,only,whenever,whatever,every time'.split(','));
    expect(new Set(table).size).toBe(table.length);
  });

  it('a phrase matches as a whole phrase: "rather than" is found, "rather" alone is not, nor is a longer word around it', () => {
    expect(findingsCheck.wordsIn('The list opens rather than the detail page.', table)).toEqual(['rather than']);
    expect(findingsCheck.wordsIn('The list is rather long, and a rather odd one.', table)).toEqual([]);
    expect(findingsCheck.wordsIn('It opens the list instead of the page.', table)).toEqual(['instead of']);
    expect(findingsCheck.wordsIn('It opens the list instead off the page and does nothing.', table)).toEqual([]);
  });

  it('the forms with an apostrophe match: won\'t, can\'t, doesn\'t, in any case, also with a typographic apostrophe', () => {
    const curly = String.fromCharCode(0x2019);
    expect(findingsCheck.wordsIn("The caller won't be asked.", table)).toEqual(["won't"]);
    expect(findingsCheck.wordsIn("It CAN'T be undone and doesn't ask.", table)).toEqual(["can't", "doesn't"]);
    expect(findingsCheck.wordsIn(`It won${curly}t be asked and can${curly}t be undone.`, table)).toEqual(["won't", "can't"]);
    expect(findingsCheck.wordsIn('A swon t is not a word, and cannot is one.', table)).toEqual(['cannot']);
  });

  it('a negative word is a whole word: "does not" and "will not" are found, "does nothing" and "willnot" are not', () => {
    expect(findingsCheck.wordsIn('It does not ask and will not answer.', table)).toEqual(['will not', 'does not']);
    expect(findingsCheck.wordsIn('It does nothing and willnot happen.', table)).toEqual([]);
  });

  it('a finding unit whose statement says "will not" and "instead of" gets both in its trace item, in the order of the table', () => {
    const run = checkedFindingsRun(cleanups);
    const doc = run.findingsDoc('F1');
    doc.findings[0].text = 'Deleting an order will not ask who calls, and answers success instead of an error.';
    run.writeFindings('F1', doc);
    expect(run.run('check-findings', ID).status).toBe(0);
    judge(run, ID);
    expect(run.run('trace', ID).status).toBe(0);
    expect(readTrace(run).items[0].scopeWords).toEqual(['will not', 'instead of']);
    // A holds verdict needs a case for each of them.
    const missing = traceFeature(run, ID, () => ({ verdict: 'holds', scope: [{ word: 'will not', case: 'a caller without a role', result: 'the order is deleted' }] }));
    expect(missing.status).toBe(1);
    expect(traceFeature(run, ID, () => 'holds').status).toBe(0);
  });
});

describe('the trace file of a findings unit', () => {
  it('gives each finding the scope words of its statement, in the order of the table, and no key when there is none', () => {
    const run = confirmedRun();
    expect(run.run('trace', ID).status).toBe(0);
    const { items } = readTrace(run);
    expect(items.map((item) => item.id)).toEqual(['findings[0]', 'findings[1]', 'findings[2]']);
    expect(items[0].scopeWords).toEqual(['every']);
    expect(items[2].scopeWords).toEqual(['always', 'whatever']);
    expect(Object.hasOwn(items[1], 'scopeWords')).toBe(false);
    expect(Object.keys(items[0])).toEqual(['id', 'claim', 'citations', 'scopeWords']);
    expect(Object.keys(items[1])).toEqual(['id', 'claim', 'citations']);
  });

  it('does not match a scope word inside another word of the statement', () => {
    const run = checkedFindingsRun(cleanups);
    run.writeFindings('F1', (() => {
      const doc = run.findingsDoc('F1');
      doc.findings[0].text = 'Deleting an order answers success overall, and the caller is not asked anything.';
      return doc;
    })());
    expect(run.run('check-findings', ID).status).toBe(0);
    judge(run, ID);
    expect(run.run('trace', ID).status).toBe(0);
    expect(Object.hasOwn(readTrace(run).items[0], 'scopeWords')).toBe(false);
  });

  it('reads the statement only, not the fixed words in front of it in the claim', () => {
    const run = withFindingsHelpers(makeRun());
    cleanups.push(run.cleanup);
    const table = translatedUi('Chinese');
    table.strings['md.findings.claimLabel'] = `${MARK}every`;
    table.strings['md.findings.scopeWords'] = `every,${CJK_SCOPE}`;
    run.writeJson(join(run.out, 'ui.json'), table);
    run.writeMap(markedMap(run.map, 'Chinese'));
    expect(run.run('check-map').status).toBe(0);
    const doc = goodFindings('F3');
    doc.findings[0].text = `${MARK}one fixed time of day`;
    run.writeFindings('F3', doc);
    expect(run.run('check-findings', unitId('F3')).status).toBe(0);
    judge(run, unitId('F3'));
    expect(run.run('trace', unitId('F3')).status).toBe(0);
    const { items } = readTrace(run, unitId('F3'));
    expect(items[0].claim).toContain(`${MARK}every`);
    expect(Object.hasOwn(items[0], 'scopeWords')).toBe(false);
    // The control: the word of the run's own table, in the statement, is found.
    doc.findings[0].text = `${MARK}one fixed time of day for ${CJK_SCOPE}`;
    run.writeFindings('F3', doc);
    expect(run.run('check-findings', unitId('F3')).status).toBe(0);
    judge(run, unitId('F3'));
    expect(run.run('trace', unitId('F3')).status).toBe(0);
    expect(readTrace(run, unitId('F3')).items[0].scopeWords).toEqual([CJK_SCOPE]);
  });

  it('never gives an entry\'s items the key, whatever the entry says', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    const entry = clone(run.entry);
    entry.purpose.text = 'Every order is always placed here by staff, whatever the customer.';
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    confirmChecked(run);
    expect(run.run('trace', 'F1').status).toBe(0);
    const { items } = readTrace(run, 'F1');
    expect(items[0].id).toBe('purpose');
    expect(items[0].claim).toContain('Every order is always placed here');
    for (const item of items) expect(Object.hasOwn(item, 'scopeWords'), item.id).toBe(false);
  });
});

describe('trace-verdicts on a holds verdict of a finding with scope words', () => {
  it('accepts a holds with one case for each word (the control)', () => {
    const run = confirmedRun();
    const result = traceWith(run, () => {});
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['F1.findings: verified (3 items)']);
    expect(stateOf(run).status).toBe('verified');
  });

  it('refuses a holds without scope and names the word', () => {
    const run = confirmedRun();
    const result = traceWith(run, (part, verdicts) => delete verdictOf(verdicts, 'findings[0]').scope);
    expect(result.status, result.stdout).toBe(1);
    expect(result.lines).toContain('part 1a: findings[0]: the holds verdict has no scope case for "every"');
    expect(result.lines.filter((line) => line.includes('scope'))).toHaveLength(1);
    expect(stateOf(run).status).toBe('confirmed');
    expect(result.lines.at(-1)).toContain('part 1a');
  });

  it('refuses a holds that leaves out one of two words and names the missing one', () => {
    const run = confirmedRun();
    const result = traceWith(run, (part, verdicts) => {
      const entry = verdictOf(verdicts, 'findings[2]');
      entry.scope = entry.scope.filter((one) => one.word === 'always');
    });
    expect(result.status, result.stdout).toBe(1);
    expect(result.lines).toContain('part 1a: findings[2]: the holds verdict has no scope case for "whatever"');
    expect(result.lines.some((line) => line.includes('"always"'))).toBe(false);
  });

  it('refuses a word the statement does not hold', () => {
    const run = confirmedRun();
    const result = traceWith(run, (part, verdicts) => verdictOf(verdicts, 'findings[0]').scope.push({ word: 'never', case: 'A case.', result: 'A result.' }));
    expect(result.status, result.stdout).toBe(1);
    expect(result.lines.some((line) => line.startsWith('part 1a: findings[0]:') && line.includes('"never"') && line.includes('not a scope word'))).toBe(true);
    expect(stateOf(run).status).toBe('confirmed');
  });

  it('refuses a word given twice', () => {
    const run = confirmedRun();
    const result = traceWith(run, (part, verdicts) => {
      const entry = verdictOf(verdicts, 'findings[0]');
      entry.scope.push({ ...entry.scope[0] });
    });
    expect(result.status, result.stdout).toBe(1);
    expect(result.lines.some((line) => line.startsWith('part 1a: findings[0]:') && line.includes('"every"') && line.includes('more than one'))).toBe(true);
  });

  it('refuses an empty case and a result of more than one line', () => {
    const run = confirmedRun();
    const empty = traceWith(run, (part, verdicts) => {
      verdictOf(verdicts, 'findings[0]').scope[0].case = '   ';
    });
    expect(empty.status, empty.stdout).toBe(1);
    expect(empty.lines.some((line) => line.startsWith('part 1a: findings[0]:') && line.includes('scope[0].case'))).toBe(true);
    const lines = traceWith(run, (part, verdicts) => {
      verdictOf(verdicts, 'findings[0]').scope[0].result = 'First line.\nSecond line.';
    });
    expect(lines.status, lines.stdout).toBe(1);
    expect(lines.lines.some((line) => line.startsWith('part 1a: findings[0]:') && line.includes('scope[0].result'))).toBe(true);
    const noResult = traceWith(run, (part, verdicts) => {
      delete verdictOf(verdicts, 'findings[0]').scope[0].result;
    });
    expect(noResult.status, noResult.stdout).toBe(1);
  });

  it('refuses a scope that is not a list of { word, case, result }', () => {
    const run = confirmedRun();
    const notList = traceWith(run, (part, verdicts) => {
      verdictOf(verdicts, 'findings[0]').scope = 'every: a case';
    });
    expect(notList.status, notList.stdout).toBe(1);
    expect(notList.lines.some((line) => line.startsWith('part 1a: findings[0]:') && line.includes('scope'))).toBe(true);
    const notObject = traceWith(run, (part, verdicts) => {
      verdictOf(verdicts, 'findings[0]').scope = ['every'];
    });
    expect(notObject.status, notObject.stdout).toBe(1);
  });

  it('checks tracer b on its own file', () => {
    const run = confirmedRun();
    const result = traceFeature(run, ID, () => 'holds', () => {}, () => 'holds', (part, verdicts) => delete verdictOf(verdicts, 'findings[2]').scope);
    expect(result.status, result.stdout).toBe(1);
    expect(result.lines).toContain('part 1b: findings[2]: the holds verdict has no scope case for "always"');
    expect(result.lines).toContain('part 1b: findings[2]: the holds verdict has no scope case for "whatever"');
    expect(result.lines.some((line) => line.startsWith('part 1a:'))).toBe(false);
  });
});

describe('trace-verdicts where scope is not required', () => {
  it('accepts a contradicted verdict without scope, and ignores a scope it has', () => {
    const run = confirmedRun();
    const bare = traceFeature(run, ID, (item) => (item.id === 'findings[0]' ? { verdict: 'contradicted', reason: 'A step before the route checks the caller.', at: [AT] } : 'holds'));
    expect(bare.status, bare.stdout).toBe(0);
    expect(bare.lines).toEqual(['F1.findings: verified, 1 item removed']);
    expect(stateOf(run).removed.map((record) => record.path)).toEqual(['findings[0]']);
  });

  it('ignores a malformed scope on a contradicted verdict', () => {
    const run = confirmedRun();
    const result = traceFeature(run, ID, (item) => (item.id === 'findings[2]' ? { verdict: 'contradicted', reason: 'Another step fills the list.', at: [AT], scope: 'nothing' } : 'holds'));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['F1.findings: verified, 1 item removed']);
  });

  it('needs no scope for an item without scope words, and ignores one it carries', () => {
    const run = confirmedRun();
    const result = traceWith(run, (part, verdicts) => {
      expect(verdictOf(verdicts, 'findings[1]').scope).toBeUndefined();
    });
    expect(result.status, result.stdout).toBe(0);
    const again = confirmedRun();
    const given = traceFeature(again, ID, (item) => (item.id === 'findings[1]' ? { verdict: 'holds', scope: [{ word: 'all', case: 'A case.', result: 'A result.' }] } : 'holds'));
    expect(given.status, given.stdout).toBe(0);
  });

  it('keeps the rules of a feature entry: a holds needs no scope', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    const entry = clone(run.entry);
    entry.purpose.text = 'Every order is always placed here by staff, whatever the customer.';
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    confirmChecked(run);
    const result = traceFeature(run, 'F1');
    expect(result.status, result.stdout).toBe(0);
  });
});
