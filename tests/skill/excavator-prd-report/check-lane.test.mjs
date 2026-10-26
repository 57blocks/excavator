// `prd.mjs check-lane <out> <id>`: a feature lane's two files (openspec
// change prd-feature-pipeline, design D3; requirement "feature-level
// findings"). The five broken lanes of design O1 are the valid fixture with
// one planted defect each.
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { ADVICE_WORDS } from '../../../skills/excavator-prd-report/lib/lane-check.mjs';
import { makeLaneRun, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
function laneRun() {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  return run;
}
const reasons = (out) => out.stdout.split('\n').filter(Boolean);
const failedReasons = (out) => reasons(out).filter((line) => !line.endsWith(': ok'));

describe('prd.mjs check-lane: its result in index.json', () => {
  it('records a failure under the feature, and clears it when the lane passes', () => {
    const run = laneRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    const findings = run.readJson('findings/F2.json');
    const good = JSON.stringify(findings);
    findings.findings[0].statement = 'The status should change.';
    run.writeJson('findings/F2.json', findings);
    const failed = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
    expect(failed.status).toBe(1);
    const recorded = run.readIndex().features.find((f) => f.id === 'F2');
    expect(recorded.status).toBe('failed');
    expect(recorded.failure).toEqual({ step: 'check-lane', reasons: ['F2-1: the statement gives advice ("should"); state the defect as it is'] });
    expect(run.readText('index.json')).toBe(`${JSON.stringify(run.readIndex(), null, 2)}\n`);
    run.writeJson('findings/F2.json', JSON.parse(good));
    expect(runPrd(['check-lane', run.out, '--project', run.project, 'F2']).status).toBe(0);
    const cleared = run.readIndex().features.find((f) => f.id === 'F2');
    expect(cleared.status).toBe('checked');
    expect(cleared.failure).toBe(null);
    expect(run.readIndex().features.find((f) => f.id === 'F1').status).toBe('planned');
  });
});

describe('prd.mjs check-lane: the valid lanes', () => {
  it('passes F1 and writes each passage\'s line back into its evidence', () => {
    const run = laneRun();
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F1']);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    const evidence = run.readJson('findings/F1.json').findings[0].evidence;
    expect(evidence.map((e) => e.line)).toEqual([2, 5]);
    expect(run.readText('findings/F1.json')).toBe(`${JSON.stringify(run.readJson('findings/F1.json'), null, 2)}\n`);
  });

  it('passes F2, whose passage is at line 11, and is stable on a second run', () => {
    const run = laneRun();
    expect(runPrd(['check-lane', run.out, '--project', run.project, 'F2']).status).toBe(0);
    expect(run.readJson('findings/F2.json').findings[0].evidence[0].line).toBe(11);
    const first = run.readText('findings/F2.json');
    expect(runPrd(['check-lane', run.out, '--project', run.project, 'F2']).status).toBe(0);
    expect(run.readText('findings/F2.json')).toBe(first);
  });

  it('passes a lane with no findings', () => {
    const run = laneRun();
    run.writeJson('findings/F2.json', { findings: [] });
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
    expect(out.status, out.stdout).toBe(0);
  });

  it('matches a passage written with curly or full-width quotes against straight quotes in the code', () => {
    const run = laneRun();
    const findings = run.readJson('findings/F2.json');
    const curly = `order.status = ${String.fromCodePoint(0x2018)}cancelled${String.fromCodePoint(0x2019)};`;
    const fullWidth = `order.status = ${String.fromCodePoint(0xff07)}cancelled${String.fromCodePoint(0xff07)};`;
    findings.findings[0].evidence = [
      { file: 'src/orders/service.js', passage: curly },
      { file: 'src/orders/service.js', passage: `${fullWidth}\n  return   order;\n}\n\nfunction reopenOrder` },
    ];
    run.writeJson('findings/F2.json', findings);
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
    expect(out.status, out.stdout).toBe(0);
    expect(run.readJson('findings/F2.json').findings[0].evidence.map((e) => e.line)).toEqual([11, 11]);
  });
});

describe('prd.mjs check-lane: the five broken lanes of design O1', () => {
  it('fails an anchor that leaves the project with ..', () => {
    const run = laneRun();
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('`src/orders/routes.js:5`', '`../outside.js:1`'));
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F1']);
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F1: anchor ../outside.js:1: the path leaves the project']);
  });

  it('fails an anchor whose line is past the end of the file', () => {
    const run = laneRun();
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('`src/orders/routes.js:5`', '`src/orders/routes.js:5-99`'));
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F1']);
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F1: anchor src/orders/routes.js:5-99: line 99 is past the end of the file (8 lines)']);
  });

  it('fails a passage that occurs twice, naming the finding and the file', () => {
    const run = laneRun();
    const findings = run.readJson('findings/F2.json');
    findings.findings[0].evidence[0].passage = 'return order;';
    run.writeJson('findings/F2.json', findings);
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F2-1: the passage occurs 2 times in src/orders/service.js; quote more of it until it occurs once']);
    // Nothing is written back while the lane fails.
    expect(run.readJson('findings/F2.json').findings[0].evidence[0].line).toBeUndefined();
  });

  it('fails a passage that is not in its file', () => {
    const run = laneRun();
    const findings = run.readJson('findings/F2.json');
    findings.findings[0].evidence[0].passage = 'deleteOrder(order.id);';
    run.writeJson('findings/F2.json', findings);
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F2-1: the passage is not in src/orders/service.js']);
  });

  it('fails a statement written as advice', () => {
    const run = laneRun();
    const findings = run.readJson('findings/F2.json');
    findings.findings[0].statement = 'cancelOrder should refuse an order that is already cancelled.';
    run.writeJson('findings/F2.json', findings);
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F2-1: the statement gives advice ("should"); state the defect as it is']);
  });
});

describe('prd.mjs check-lane: the advice words', () => {
  it('lists English words and Chinese ones, each catching a statement on its own', () => {
    expect(ADVICE_WORDS).toContain('should');
    expect(ADVICE_WORDS.some((word) => /[^\x00-\x7f]/.test(word))).toBe(true);
    for (const word of ADVICE_WORDS) {
      const run = laneRun();
      const findings = run.readJson('findings/F2.json');
      findings.findings[0].statement = `The status ${word} change for a cancelled order.`;
      run.writeJson('findings/F2.json', findings);
      const out = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
      expect(out.status, word).toBe(1);
      run.cleanup();
    }
  });

  it('passes advice words inside code spans, in names (capitalized, hyphenated or joined to a word) and other cases', () => {
    const run = laneRun();
    const findings = run.readJson('findings/F2.json');
    for (const statement of [
      'The Leave-Recommend page sends the mail twice.',
      'The RecommendMail job runs before the order is saved.',
      'The `refactor.mode` key and the `should` flag are read twice.',
      'The should-not marker is ignored; the -Recommend suffix is dropped.',
      'The leave-recommend route and the auto-suggest box return the list twice.',
      'Recommend appears as a button label on two pages.',
    ]) {
      findings.findings[0].statement = statement;
      run.writeJson('findings/F2.json', findings);
      const out = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
      expect(out.status, `${statement}\n${out.stdout}`).toBe(0);
    }
    for (const statement of ['The status should change.', 'The form (should) be checked.', 'It is recommended to retry.', 'The page suggests, then refactors.']) {
      findings.findings[0].statement = statement;
      run.writeJson('findings/F2.json', findings);
      expect(runPrd(['check-lane', run.out, '--project', run.project, 'F2']).status, statement).toBe(1);
    }
  });

  it('refuses exactly these words: the English ones and six Chinese ones', () => {
    const cjk = (...points) => String.fromCodePoint(...points);
    expect(ADVICE_WORDS).toEqual([
      'should', 'recommend', 'suggest', 'refactor', 'ought to', 'better to', 'it would be better',
      cjk(0x5efa, 0x8bae), cjk(0x5e94, 0x8be5), cjk(0x5e94, 0x5f53), cjk(0x63a8, 0x8350), cjk(0x91cd, 0x6784), cjk(0x4f18, 0x5316),
    ]);
  });

  it('passes As-Is statements that use must, improve, consider or needs to be, and the two dropped Chinese words', () => {
    const cjk = (...points) => String.fromCodePoint(...points);
    const run = laneRun();
    const findings = run.readJson('findings/F2.json');
    findings.findings[0].statement = 'Only a user who must be an admin can cancel; the form does not consider the quantity, the total needs to be positive and retries do not improve the result.';
    run.writeJson('findings/F2.json', findings);
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
    expect(out.status, out.stdout).toBe(0);
    for (const word of [cjk(0x9700, 0x8981, 0x6539), cjk(0x53ef, 0x4ee5, 0x6539)]) {
      findings.findings[0].statement = `The status ${word} cancelled.`;
      run.writeJson('findings/F2.json', findings);
      expect(runPrd(['check-lane', run.out, '--project', run.project, 'F2']).status).toBe(0);
    }
  });

  it('does not catch words that only contain one, such as shoulder or considered', () => {
    const run = laneRun();
    const findings = run.readJson('findings/F2.json');
    findings.findings[0].statement = 'The shoulder field is considered optional and is mustered from the request.';
    run.writeJson('findings/F2.json', findings);
    expect(runPrd(['check-lane', run.out, '--project', run.project, 'F2']).status).toBe(0);
  });
});

describe('prd.mjs check-lane: the chapter file and the findings schema', () => {
  it('fails missing files as lane-wrote-nothing', () => {
    const run = laneRun();
    rmSync(join(run.out, 'findings/F1.json'));
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F1']);
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F1: lane-wrote-nothing: findings/F1.json is missing']);
  });

  it('fails a front-matter id that is not the feature, no mermaid block and no evidence block', () => {
    const run = laneRun();
    const text = run.readText('features/F1.md')
      .replace('id: F1', 'id: F3')
      .replace('```mermaid', '```text')
      .replace(/<details>[\s\S]*<\/details>\n/, '');
    run.writeText('features/F1.md', text);
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F1']);
    expect(out.status).toBe(1);
    const lines = failedReasons(out).join('\n');
    expect(lines).toMatch(/F1: front-matter id is "F3"/);
    expect(lines).toMatch(/F1: no mermaid block/);
    expect(lines).toMatch(/F1: no <details> evidence block/);
  });

  it('says how to write an anchor when the evidence blocks hold none in backticks', () => {
    const run = laneRun();
    run.writeText('features/F2.md', run.readText('features/F2.md').replace(/`(src\/orders\/[^`]+)`/g, '$1'));
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F2']);
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toContain('F2: no anchor in the <details> evidence blocks: write each anchor in backticks, as `path:line` or `path:line-line`, with the path from the project root');
  });

  it('fails a chapter file with no front-matter', () => {
    const run = laneRun();
    run.writeText('features/F1.md', run.readText('features/F1.md').replace(/^---\n[\s\S]*?\n---\n/, ''));
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F1']);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/F1: features\/F1\.md has no front-matter/);
  });

  it('fails a finding with a wrong class, an id of another feature, a severity and no evidence', () => {
    const run = laneRun();
    run.writeJson('findings/F1.json', {
      findings: [
        { id: 'F2-1', class: 'ux', statement: 'x', flows: ['F1'], evidence: [], severity: 'high' },
      ],
    });
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F1']);
    expect(out.status).toBe(1);
    const lines = out.stdout;
    expect(lines).toMatch(/id "F2-1" is not F1-<n>/);
    expect(lines).toMatch(/class "ux"/);
    expect(lines).toMatch(/severity/);
    expect(lines).toMatch(/no evidence/);
  });

  it('exits 2 for a feature id the index does not have', () => {
    const run = laneRun();
    const out = runPrd(['check-lane', run.out, '--project', run.project, 'F9']);
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/F9/);
  });
});
