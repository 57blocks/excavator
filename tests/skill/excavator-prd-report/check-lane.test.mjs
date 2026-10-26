// `prd.mjs check-lane <out> <id>`: a feature lane's two files (openspec
// change prd-feature-pipeline, design D3; requirement "feature-level
// findings"). The five broken lanes of design O1 are the valid fixture with
// one planted defect each.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ADVICE_WORDS } from '../../../skills/excavator-prd-report/lib/lane-check.mjs';
import { makeLaneRun, makeSkeletonRun, runPrd } from './helpers.mjs';

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
const failedReasons = (out) => reasons(out).filter((line) => !line.endsWith(': ok') && !line.startsWith('Next: '));

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

// Change prd-report-prd-shape, design D3, D6 and D8; oracle O2: each problem
// line has a test of its own, and one fully valid chapter passes.
const check = (run, id) => runPrd(['check-lane', run.out, '--project', run.project, id]);
const edit = (run, id, change) => run.writeText(`features/${id}.md`, change(run.readText(`features/${id}.md`)));
const setKind = (run, id, kind) => {
  const index = run.readIndex();
  index.features.find((f) => f.id === id).kind = kind;
  run.writeIndex(index);
  edit(run, id, (text) => text.replace('kind: flow', `kind: ${kind}`));
};

describe('prd.mjs check-lane: the declared structure of a chapter (D3)', () => {
  it('passes a fully valid chapter with actors, permission roles, flows and the open items heading last', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.actors.push('Payment service');
    run.writeIndex(index);
    edit(run, 'F1', (text) => text
      .replace('actors: [customer]\npermissionRoles: []', 'actors: [customer, "Payment service"]\npermissionRoles: [normal, admin]')
      .replace('chapter: 1', 'openItems: Open items\nchapter: 1')
      .replace('- "Flow 1: Place an order"', '- "Flow 1: Place an order"\n  - "Flow 2: Place a repeat order"')
      .replace('<details>', '### Flow 2: Place a repeat order\n\nA repeat order copies the last one.\n\n<details>')
      .concat('\n### Open items\n\n| Item | Searched |\n|---|---|\n| Refund rule | the whole project |\n'));
    const out = check(run, 'F1');
    expect(out.status, out.stdout).toBe(0);
    expect(reasons(out)).toEqual(['F1: ok']);
  });

  it('refuses the roles key, which is no longer read', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text.replace('actors: [customer]', 'actors: [customer]\nroles: [customer]'));
    const out = check(run, 'F1');
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F1: front-matter roles is no longer read; write actors and permissionRoles']);
  });

  it('refuses actors, permissionRoles and flows that are not lists, one line each', () => {
    for (const [key, replacement] of [
      ['actors', 'actors: customer'],
      ['permissionRoles', 'permissionRoles: admin'],
      ['flows', 'flows: Flow 1: Place an order'],
    ]) {
      const run = laneRun();
      edit(run, 'F1', (text) => text.replace(new RegExp(`^${key}:.*(\\n  - .*)*`, 'm'), replacement));
      const out = check(run, 'F1');
      expect(out.status, key).toBe(1);
      expect(failedReasons(out), key).toContain(`F1: front-matter ${key} is not a list`);
    }
  });

  it('refuses a front-matter without permissionRoles as not a list', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text.replace('permissionRoles: []\n', ''));
    expect(failedReasons(check(run, 'F1'))).toEqual(['F1: front-matter permissionRoles is not a list']);
  });

  // Change prd-report-prd-shape, design D12: a chapter names only the actors of the index.
  it('refuses an actor that is not one of the index\'s actors, one line per name, and matches the spelling exactly', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text.replace('actors: [customer]', 'actors: [customer, Auditor, "support  agent", "Payment service"]'));
    const out = check(run, 'F1');
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual([
      'F1: actor "Auditor" is not one of the index\'s actors',
      'F1: actor "support  agent" is not one of the index\'s actors',
      'F1: actor "Payment service" is not one of the index\'s actors',
    ]);
    const lower = laneRun();
    edit(lower, 'F2', (text) => text.replace('actors: [support agent]', 'actors: [Support agent]'));
    expect(failedReasons(check(lower, 'F2'))).toEqual(['F2: actor "Support agent" is not one of the index\'s actors']);
  });

  it('keeps the actor and permission role overlap check next to the index check', () => {
    const run = laneRun();
    edit(run, 'F2', (text) => text.replace('permissionRoles: [admin]', 'permissionRoles: [admin, support agent]').replace('actors: [support agent]', 'actors: [support agent, Auditor]'));
    expect(failedReasons(check(run, 'F2'))).toEqual([
      'F2: support agent is both an actor and a permission role',
      'F2: actor "Auditor" is not one of the index\'s actors',
    ]);
  });

  it('refuses a name that is both an actor and a permission role', () => {
    const run = laneRun();
    edit(run, 'F2', (text) => text.replace('permissionRoles: [admin]', 'permissionRoles: [admin, support agent]'));
    const out = check(run, 'F2');
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F2: support agent is both an actor and a permission role']);
  });

  it('refuses a flow that is not a ### heading of the chapter, even when it is another heading level', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text.replace('- "Flow 1: Place an order"', '- "Flow 1: Place an order"\n  - "Flow 9: Not written"\n  - "Order placement"'));
    const out = check(run, 'F1');
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual([
      'F1: flow "Flow 9: Not written" is not a ### heading of the chapter',
      'F1: flow "Order placement" is not a ### heading of the chapter',
    ]);
  });

  it('does not take a heading inside a code fence for a heading of the chapter', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text.replace('- "Flow 1: Place an order"', '- "Flow 1: Place an order"\n  - "Flow 3: In a fence"').replace('sequenceDiagram', '### Flow 3: In a fence\n  sequenceDiagram'));
    expect(failedReasons(check(run, 'F1'))).toEqual(['F1: flow "Flow 3: In a fence" is not a ### heading of the chapter']);
  });

  describe('flows that assemble can index (change prd-report-prd-shape, design D4)', () => {
    it('refuses a flow that is the open items heading', () => {
      const run = laneRun();
      edit(run, 'F1', (text) => text
        .replace('chapter: 1', 'openItems: Open items\nchapter: 1')
        .replace('- "Flow 1: Place an order"', '- "Flow 1: Place an order"\n  - "Open items"')
        .concat('\n### Open items\n\nNothing searched yet.\n'));
      const out = check(run, 'F1');
      expect(out.status).toBe(1);
      expect(failedReasons(out)).toEqual(['F1: flow "Open items" is the open items heading; list only the flows']);
    });

    it('refuses a title listed more times than the chapter has ### headings with that text', () => {
      const run = laneRun();
      edit(run, 'F1', (text) => text.replace('- "Flow 1: Place an order"', '- "Flow 1: Place an order"\n  - "Flow 1: Place an order"'));
      const out = check(run, 'F1');
      expect(out.status).toBe(1);
      expect(failedReasons(out)).toEqual(['F1: flow "Flow 1: Place an order" is listed 2 times; the chapter has 1 ### headings with that text']);
    });

    it('says only "is not a ### heading" for a title the chapter does not have at all', () => {
      const run = laneRun();
      edit(run, 'F1', (text) => text.replace('- "Flow 1: Place an order"', '- "Flow 1: Place an order"\n  - "Flow 9: Not written"\n  - "Flow 9: Not written"'));
      expect(failedReasons(check(run, 'F1')).filter((line) => line.includes('Flow 9'))).toEqual([
        'F1: flow "Flow 9: Not written" is not a ### heading of the chapter',
        'F1: flow "Flow 9: Not written" is not a ### heading of the chapter',
      ]);
    });

    it('passes a title listed twice when the chapter has two ### headings with that text', () => {
      const run = makeSkeletonRun();
      cleanups.push(run.cleanup);
      expect(run.readText('features/F2.md')).toContain('flows: [Cancel an order, Cancel an order]');
      const out = check(run, 'F2');
      expect(out.status, out.stdout).toBe(0);
    });

    it('refuses a chapter that ends inside an open code fence', () => {
      const run = laneRun();
      edit(run, 'F1', (text) => `${text}\n\n\`\`\`text\nnever closed\n`);
      const out = check(run, 'F1');
      expect(out.status).toBe(1);
      expect(failedReasons(out)).toEqual(['F1: the chapter ends inside an open code fence; close it']);
    });
  });

  it('refuses a flow or automated feature that lists no flow', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text.replace(/flows:\n  - .*\n/, 'flows: []\n'));
    expect(failedReasons(check(run, 'F1'))).toEqual(['F1: a flow feature lists no flow']);
    setKind(run, 'F1', 'automated');
    expect(failedReasons(check(run, 'F1'))).toEqual(['F1: an automated feature lists no flow']);
  });

  it('refuses a reference feature that lists flows, and passes one that lists none', () => {
    const run = laneRun();
    setKind(run, 'F1', 'reference');
    const out = check(run, 'F1');
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F1: a reference feature lists flows']);
    edit(run, 'F1', (text) => text.replace(/flows:\n  - .*\n/, 'flows: []\n').replace('### Flow 1: Place an order\n\n', ''));
    expect(check(run, 'F1').status).toBe(0);
  });

  it('refuses an open items heading that is not a ### heading of the chapter', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text.replace('chapter: 1', 'openItems: Open items\nchapter: 1'));
    const out = check(run, 'F1');
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F1: open items heading "Open items" is not a ### heading of the chapter']);
  });

  it('refuses an open items heading that is not the last ### heading', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text
      .replace('chapter: 1', 'openItems: Open items\nchapter: 1')
      .replace('<details>', '### Open items\n\nNothing searched yet.\n\n<details>'));
    const out = check(run, 'F1');
    expect(out.status).toBe(0);
    edit(run, 'F1', (text) => text.concat('\n### Later\n\nAfter the open items.\n'));
    const second = check(run, 'F1');
    expect(second.status).toBe(1);
    expect(failedReasons(second)).toEqual(['F1: open items heading "Open items" is not the last ### heading']);
  });

  it('refuses a chapter with two ## headings, and one with none', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text.concat('\n## Verification summary\n\nAppended by a check.\n'));
    expect(failedReasons(check(run, 'F1'))).toEqual(['F1: the chapter has 2 ## headings; it has one, ## Order placement, as its first heading']);
    edit(run, 'F1', (text) => text.replace('## Order placement\n', '').replace('## Verification summary\n', ''));
    expect(failedReasons(check(run, 'F1'))).toEqual(['F1: the chapter has 0 ## headings; it has one, ## Order placement, as its first heading']);
  });

  it('refuses a chapter whose first heading is not its ## heading', () => {
    const run = laneRun();
    edit(run, 'F1', (text) => text.replace('## Order placement\n', '### Flow 0: Early\n\n## Order placement\n'));
    expect(failedReasons(check(run, 'F1'))).toEqual(['F1: the chapter has 1 ## headings; it has one, ## Order placement, as its first heading']);
  });
});

describe('prd.mjs check-lane: anchors and passages in directories that hold dependencies (D8)', () => {
  const plant = (run) => {
    for (const dir of ['node_modules/pkg', 'vendor/lib', 'src/build']) {
      mkdirSync(join(run.project, dir), { recursive: true });
      writeFileSync(join(run.project, dir, 'index.js'), 'module.exports = 1;\n');
    }
  };

  it('refuses an anchor under each skipped directory name', () => {
    const run = laneRun();
    plant(run);
    for (const [path, dir] of [['node_modules/pkg/index.js', 'node_modules'], ['vendor/lib/index.js', 'vendor'], ['src/build/index.js', 'build']]) {
      edit(run, 'F1', (text) => text.replace('`src/orders/routes.js:5`', `\`${path}:1\``));
      const out = check(run, 'F1');
      expect(out.status, path).toBe(1);
      expect(failedReasons(out), path).toEqual([`F1: anchor ${path}:1: the path is under ${dir}, which holds dependencies or build output, not the project's code`]);
      edit(run, 'F1', (text) => text.replace(`\`${path}:1\``, '`src/orders/routes.js:5`'));
    }
    expect(check(run, 'F1').status).toBe(0);
  });

  it('refuses a finding whose evidence file is under a skipped directory', () => {
    const run = laneRun();
    plant(run);
    const findings = run.readJson('findings/F2.json');
    findings.findings[0].evidence = [{ file: 'node_modules/pkg/index.js', passage: 'module.exports = 1;' }];
    run.writeJson('findings/F2.json', findings);
    const out = check(run, 'F2');
    expect(out.status).toBe(1);
    expect(failedReasons(out)).toEqual(['F2-1: evidence[0] file "node_modules/pkg/index.js" is under node_modules, which holds dependencies or build output, not the project\'s code']);
  });
});

describe('prd.mjs check-lane: the Next line of a failed lane (D6)', () => {
  const broken = (run) => edit(run, 'F1', (text) => text.replace('```mermaid', '```text'));
  const last = (out) => reasons(out).at(-1);

  it('ends with the re-dispatch line while the lane has had fewer than two attempts', () => {
    for (const attempts of [undefined, 0, 1]) {
      const run = laneRun();
      const index = run.readIndex();
      if (attempts !== undefined) index.features[0].attempts = attempts;
      run.writeIndex(index);
      broken(run);
      const out = check(run, 'F1');
      expect(out.status).toBe(1);
      expect(last(out), String(attempts)).toBe("Next: delete F1's files, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)");
      expect(reasons(out)[0]).toBe('F1: no mermaid block');
    }
  });

  it('ends with the stays-failed line after two attempts', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.features[0].attempts = 2;
    run.writeIndex(index);
    broken(run);
    const out = check(run, 'F1');
    expect(out.status).toBe(1);
    expect(last(out)).toBe('Next: F1 stays failed (2 of 2 attempts)');
  });

  it('prints it for lane-wrote-nothing too, and not for a lane that passes', () => {
    const run = laneRun();
    rmSync(join(run.out, 'findings/F1.json'));
    const out = check(run, 'F1');
    expect(reasons(out)).toEqual([
      'F1: lane-wrote-nothing: findings/F1.json is missing',
      "Next: delete F1's files, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)",
    ]);
    const fine = laneRun();
    expect(reasons(check(fine, 'F2'))).toEqual(['F2: ok']);
  });

  it('keeps the Next line out of the failure recorded in index.json', () => {
    const run = laneRun();
    broken(run);
    check(run, 'F1');
    expect(run.readIndex().features[0].failure).toEqual({ step: 'check-lane', reasons: ['F1: no mermaid block'] });
  });
});
