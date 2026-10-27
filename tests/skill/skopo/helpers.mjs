/**
 * Fixtures for the skopo skills: a small, lint-clean skopository and a finished run around it, in
 * a temporary output directory. Every test writes its own copy and changes it from there.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, '../../..');
export const SKOPO_CLI = resolve(repoRoot, 'skills/skopo-create/skopo.mjs');
const CHECKER = resolve(repoRoot, 'skills/skopo-create/checker');

export const REVISION = 'git:1111111111111111111111111111111111111111';

const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

export const SKOPO_FILES = {
  'skopo.json': '{"specVersion": "0.1.0"}\n',
  'README.md': [
    '# Permits: the skopository',
    '',
    'Intent documentation for a residents\' parking permit service.',
    '',
    '## What is not here',
    '',
    'Payments and enforcement: the city handles them.',
    '',
  ].join('\n'),
  'spec/permits.md': [
    '# Permits',
    '',
    '## Words',
    '',
    '- A **resident** is a person registered at an address in the zone. ^T-0b7199',
    '- A **permit** lets one vehicle park in one zone for one year. ^T-aq165k',
    '',
    '## Rules',
    '',
    '- A resident **must not** hold more than two permits at once. ^R-cxsjfa',
    '- A permit **must not** outlast the resident\'s registration. ^R-5tps87',
    '',
  ].join('\n'),
  'bindings/product/portal.md': [
    '# Portal: product binding',
    '',
    '- Residents apply for a permit on a web portal. ^F-j0jc17 (R-cxsjfa)',
    '',
  ].join('\n'),
  'bindings/tech/portal.md': [
    '# Portal: tech binding',
    '',
    '- The portal checks the register before it issues a permit. ^D-dz64m8 (F-j0jc17, R-5tps87)',
    '',
  ].join('\n'),
};

export const QUESTIONS = [
  '# Questions from the recovery of Permits',
  '',
  '| # | Category | Question | Sources that disagree | Statements it bears on |',
  '|---|---|---|---|---|',
  '| 1 | documentation | Is the two-permit limit still in the handbook? | handbook · code | R-cxsjfa |',
  '| 2 | security | Who may revoke a permit? | code · runbook | R-5tps87 |',
  '| 3 | money | Is a permit refunded when a resident moves? | code · terms | R-5tps87 |',
  '',
  '## Decisions without a recorded reason',
  '',
  '- Permits last one year: the issue form (T-aq165k).',
  '',
].join('\n');

export const SUMMARY = [
  '# Permits',
  '',
  'The service issues parking permits to residents of a zone (T-0b7199, T-aq165k).',
  '',
  '- Each resident holds at most two permits (R-cxsjfa).',
  '- Residents apply on the portal (F-j0jc17).',
  '',
].join('\n');

/** Writes the fixture skopository into `dir`. */
export function writeSkopo(dir) {
  for (const [file, text] of Object.entries(SKOPO_FILES)) write(join(dir, file), text);
  copyFileSync(join(CHECKER, 'keywords.json'), join(dir, 'keywords.json'));
}

/** The run record as skopo.mjs start writes it, with `changes` merged over it. */
export function runRecord(changes = {}) {
  return {
    format: 'excavator-skopo/1',
    runId: '20261027T000000Z',
    plugin: 'excavator@test',
    projectRoot: '/project',
    sourceRevision: REVISION,
    scope: null,
    workspace: '/out',
    startedAt: '2026-10-27T00:00:00.000Z',
    endedAt: null,
    node: process.version,
    decisions: {},
    phases: [],
    lintPasses: [],
    ...changes,
  };
}

/**
 * A temporary output directory at the given stage: `started` (run only), `planned` (plus plan and
 * research), `created` (plus the skopository, questions, notes, metrics and an end time) or
 * `reported` (plus the summary).
 */
export function makeOut(stage = 'created', { run = {} } = {}) {
  const out = join(mkdtempSync(join(tmpdir(), 'skopo-out-')), 'skopo');
  const stages = ['started', 'planned', 'created', 'reported'];
  const at = stages.indexOf(stage);
  const decisions = at >= 1 ? { plan: 'auto' } : {};
  write(join(out, 'run', 'run.json'), `${JSON.stringify(runRecord({ decisions, endedAt: at >= 2 ? '2026-10-27T01:00:00.000Z' : null, ...run }), null, 1)}\n`);
  mkdirSync(join(out, 'run', 'lint'), { recursive: true });
  mkdirSync(join(out, 'run', 'research'), { recursive: true });
  if (at >= 1) {
    write(join(out, 'run', 'plan.md'), '# Plan\n\nOne domain, permits.\n');
    write(join(out, 'run', 'research', 'world.md'), '# world\n\nreport complete: 2 rules, 0 conflicts, 0 recorded reasons\n');
  }
  if (at >= 2) {
    writeSkopo(join(out, 'skopo'));
    write(join(out, 'run', 'questions.md'), QUESTIONS);
    write(join(out, 'run', 'notes.md'), '# Notes on this run\n\n## Placement doubts\n\nNone; R-cxsjfa was clear.\n');
    write(join(out, 'run', 'metrics.json'), `${JSON.stringify({
      statements: { total: 7, byKind: { T: 2, A: 0, W: 0, R: 2, E: 0, F: 1, D: 1 } },
      source: { repos: 1, files: 10, codeLines: 1200, docWords: 300 },
      lint: { passes: 2, last: { n: 2, errors: 0, warnings: 0 } },
    }, null, 1)}\n`);
  }
  if (at >= 3) write(join(out, 'report', 'summary.md'), SUMMARY);
  return out;
}

export const cleanup = (out) => rmSync(dirname(out), { recursive: true, force: true });

/** Runs skopo.mjs with `args`. */
export function runSkopo(args) {
  const result = spawnSync(process.execPath, [SKOPO_CLI, ...args], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A temporary Git project with one commit; returns its root. */
export function makeGitProject() {
  const root = mkdtempSync(join(tmpdir(), 'skopo-project-'));
  write(join(root, 'README.md'), '# project\n');
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init');
  return root;
}
