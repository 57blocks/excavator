/**
 * resumable-scoped-full: the orchestration rules that live in SKILL.md prose
 * rather than in a script — clear the previous run's per-batch files, commit
 * each batch as it returns, skip Phase F3 under --scope, stop --estimate
 * before any dispatch — and the estimate addendum's formula, rates and
 * provenance.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator/SKILL.md'), 'utf-8');
const estimate = readFileSync(resolve(repoRoot, 'skills/excavator/full-run-estimate.md'), 'utf-8');

const flat = (text) => text.replace(/\s+/g, ' ');
function section(from, to) {
  const start = skill.indexOf(from);
  expect(start, `SKILL.md should contain ${from}`).toBeGreaterThanOrEqual(0);
  const end = skill.indexOf(to, start);
  expect(end, `SKILL.md should contain ${to} after ${from}`).toBeGreaterThan(start);
  return skill.slice(start, end);
}

describe('SKILL.md options', () => {
  const options = flat(section('## Options', '## Progress Reporting'));

  it('documents --scope and --estimate as --full only', () => {
    expect(options).toContain('`--scope <dir>` — Only with `--full`.');
    expect(options).toContain('`--estimate` — Only with `--full`, optionally with `--scope`.');
    expect(options).toContain('`--scope` or `--estimate` without `--full`: tell the user it requires `--full` and **STOP**.');
  });

  it('does not take the --scope value for the project path', () => {
    expect(flat(skill)).toContain('is not the value of `--exclude` or `--scope`). If found, treat it as the target directory path.');
  });
});

describe('Phase F resumes from what it has committed', () => {
  const intro = section('## Phase F — Full Semantic Generation', '### Phase F1');

  it('moves every kind of per-batch file into the trash before Phase F1', () => {
    const move = intro.slice(intro.indexOf('**Before Phase F1**'));
    expect(move).toContain('TRASH="$DATA_DIR/.trash-$(date +%s)"');
    for (const pattern of ['semantic-patch-batch-*.json', 'semantic-patch-report-*.json', 'semantic-verify-batch-*.json', 'summary-verdicts-*.json']) {
      expect(move).toContain(`'${pattern}'`);
    }
    expect(move).toContain('-exec mv {} "$TRASH/"');
    expect(move).not.toMatch(/\brm\b/);
  });

  it('says a re-run of the same command resumes, with no other state file', () => {
    expect(flat(intro)).toContain('resumes when the same command is run again');
    expect(flat(intro)).toContain('There is no other state file.');
  });

  it('puts the commit-on-return rule where Phase F2 dispatches, not only in the commit step', () => {
    // A first real run waited for every batch before committing: the rule
    // sat only in step 4, after the dispatch instructions it was following.
    const step3 = flat(section('3. **Dispatch file-analyzer', '4. **Hydrate + commit.**'));
    expect(step3).toContain('**Each time an analyzer returns, run step 4 for its batch right away, before you dispatch another batch or wait for the rest, and report `Batch <i>/<N> committed.`**');
    expect(step3).toContain('Do not wait for every batch and commit them together');
  });

  it('commits each Phase F2 batch as soon as its analyzer returns', () => {
    const step4 = flat(section('4. **Hydrate + commit.**', '### Phase F3'));
    expect(step4).toContain('Do this for each batch as soon as its analyzer returns, one batch at a time, without waiting for the batches still running.');
  });

  it('commits each Phase F4 batch with apply-semantic --batch before the closing apply-semantic', () => {
    const f4 = section('### Phase F4', '### Phase F5');
    const perBatch = f4.indexOf('apply-semantic --batch <i>');
    const closing = f4.indexOf('apply-semantic\n```');
    expect(perBatch).toBeGreaterThan(0);
    expect(closing).toBeGreaterThan(perBatch);
    expect(flat(f4)).toContain('**Each time a verifier returns, commit its batch right away, before you dispatch another batch or wait for the rest, and report `Verification batch <i>/<N> committed.`**');
    expect(flat(f4)).toContain('Do not wait for every batch and commit them together');
  });
});

describe('--scope and --estimate in Phase F', () => {
  it('passes --scope to both selection scripts', () => {
    expect(section('### Phase F2', '2. **Batch the stale files**')).toContain('select-stale-semantics.mjs" "$PROJECT_ROOT" [--scope "<dir>"]');
    expect(section('### Phase F4', '### Phase F5')).toContain('prepare-semantic [--scope "<dir>"]');
  });

  it('skips Phase F3 under --scope before checking the architecture', () => {
    const f3 = section('### Phase F3', '### Phase F4');
    const skip = f3.indexOf('**With `--scope`, skip Phase F3.**');
    expect(skip).toBeGreaterThan(0);
    expect(skip).toBeLessThan(f3.indexOf('semantic-graph.mjs" "$PROJECT_ROOT" check'));
  });

  it('stops --estimate after batching, before the first dispatch', () => {
    const f2 = section('### Phase F2', '### Phase F3');
    const stop = f2.indexOf('**With `--estimate`, stop here.** Dispatch nothing.');
    expect(stop).toBeGreaterThan(f2.indexOf('compute-batches.mjs'));
    expect(stop).toBeLessThan(f2.indexOf('3. **Dispatch file-analyzer'));
    expect(flat(f2.slice(stop))).toContain('Follow `<SKILL_DIR>/full-run-estimate.md`');
  });
});

describe('full-run-estimate.md', () => {
  it('gives the counts, the formula and the rate table', () => {
    expect(estimate).toContain('cost_usd = 4.00 + 0.04 × D + 0.60 × B2 + 0.38 × B4 + 2.40 × F3');
    expect(estimate).toContain('wall_min = 2.6 + F2_wall + 1.54 × B4 + 12 × F3');
    expect(estimate).toContain('F2_wall  = 0 when B2 is 0, otherwise max(6, 1.24 × B2)');
    expect(estimate).toContain('`D = B2 + B4 + 2 × F3`');
    expect(estimate).toContain('`B4 = ceil(V / 30)`');
    expect(estimate).toContain('| Phase F2, per batch | $0.60 | 1.24 min, at least 6 min |');
    expect(estimate).toContain('| Phase F4, per batch | $0.38 | 1.54 min |');
    expect(estimate).toContain('| Phase F3 | $2.40 | 12 min |');
  });

  it('names the model, the calibration and the check behind the rates', () => {
    expect(estimate).toContain('**Model:** Sonnet.');
    expect(estimate).toContain('**Calibration:**');
    expect(estimate).toContain('**Check:**');
    expect(estimate).toContain('cost within ±30%, wall time within ±50%');
  });

  it('records the checks run after calibration, including the one outside the tolerance', () => {
    expect(flat(estimate)).toContain('$22.38 against $18.98 actual (−15%), and 56.3 minutes against 39.8 (−29%)');
    expect(flat(estimate)).toContain('Small runs come in under the estimate, because the fixed term dominates them');
    expect(flat(estimate)).toContain('was estimated at $6.12 and cost $3.73 (−39%)');
  });

  it('gives the dispatch limit and the runner timeout as hints', () => {
    expect(estimate).toContain('**`B2 + B4` above 100:**');
    expect(estimate).toContain('**Estimated wall time above 180 minutes:**');
  });

  it('reproduces the calibration run from its own formula', () => {
    // 19 F2 batches, 28 F4 batches, Phase F3 run: $30.42 actual.
    const B2 = 19, B4 = 28, F3 = 1, D = B2 + B4 + 2 * F3;
    const cost = 4.0 + 0.04 * D + 0.6 * B2 + 0.38 * B4 + 2.4 * F3;
    expect(cost).toBeCloseTo(30.4, 1);
  });
});
