#!/usr/bin/env node
// Records one recovery run, so it can be analysed afterwards: when each phase started, every lint
// pass, and the final measurements. Everything lands in <workspace>/.skopo/runs/<run-id>/, which
// ignores itself in git.
// Usage:
//   node run.mjs start  <workspace>                 creates the run directory and prints its path
//   node run.mjs set    <run-dir> key=value …       records a decision (skopo path, topology, …)
//   node run.mjs phase  <run-dir> <name> [note …]   marks the start of a phase
//   node run.mjs lint   <run-dir> <skopo-dir>       runs the lint and checks the run's citations, keeps the
//                                                    output, passes the lint's exit code on
//   node run.mjs finish <run-dir> <skopo-dir>       writes metrics.json and closes the run
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSpec, loadProduct, loadTech, loadRecords, mdFiles, refsIn, KINDS } from './spec.mjs';

const SCRIPTS = import.meta.dirname;
// Inside a harness plugin the scripts sit next to its manifest; run from tools/cli they report the source.
const manifest = join(SCRIPTS, '..', '.claude-plugin', 'plugin.json');
const PLUGIN = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : { name: 'skopo-cli', version: 'source' };
const now = () => new Date().toISOString();
const fail = (msg) => { console.error(`run: ${msg}`); process.exit(2); };

const runFile = (dir) => join(dir, 'run.json');
const readRun = (dir) => {
  if (!existsSync(runFile(dir))) fail(`no run.json in ${dir}; start a run first`);
  return JSON.parse(readFileSync(runFile(dir), 'utf8'));
};
const writeRun = (dir, run) => writeFileSync(runFile(dir), `${JSON.stringify(run, null, 1)}\n`);
const update = (dir, change) => writeRun(dir, change(readRun(dir)));

function start(workspace) {
  const ws = resolve(workspace);
  if (!existsSync(ws)) fail(`no such directory: ${ws}`);
  const base = join(ws, '.skopo');
  mkdirSync(join(base, 'runs'), { recursive: true });
  if (!existsSync(join(base, '.gitignore'))) writeFileSync(join(base, '.gitignore'), '# Skopo run data: kept for analysis, never committed.\n*\n');
  const id = now().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dir = join(base, 'runs', id);
  for (const sub of ['research', 'lint']) mkdirSync(join(dir, sub), { recursive: true });
  writeRun(dir, {
    runId: id,
    plugin: `${PLUGIN.name}@${PLUGIN.version}`,
    workspace: ws,
    startedAt: now(),
    endedAt: null,
    node: process.version,
    decisions: {},
    phases: [],
    lintPasses: [],
  });
  console.log(dir);
}

function set(dir, pairs) {
  const entries = pairs.map((p) => {
    const at = p.indexOf('=');
    if (at < 1) fail(`expected key=value, got "${p}"`);
    return [p.slice(0, at), p.slice(at + 1)];
  });
  update(dir, (run) => ({ ...run, decisions: { ...run.decisions, ...Object.fromEntries(entries) } }));
}

function phase(dir, name, note) {
  if (!name) fail('phase needs a name');
  update(dir, (run) => ({ ...run, phases: [...run.phases, { name, startedAt: now(), ...(note ? { note } : {}) }] }));
}

// The run's questions and notes cite statements too. Lint reads only the skopo, so check those
// citations here: every ID must exist with its kind, and no placeholder may be left.
function runCitations(dir, skopo) {
  const kindOf = new Map([loadSpec, loadProduct, loadTech].flatMap((load) => load(skopo).statements).map((st) => [st.key, st.kind]));
  const placeholder = new RegExp(`[${KINDS}]-@[a-z0-9][a-z0-9-]*`, 'g');
  return ['questions.md', 'notes.md'].filter((f) => existsSync(join(dir, f))).flatMap((f) =>
    readFileSync(join(dir, f), 'utf8').split('\n').flatMap((line, i) => [
      ...refsIn(line).filter((r) => kindOf.get(r.key) !== r.kind).map((r) => (kindOf.has(r.key)
        ? `RUN ${f}:${i + 1}  ${r.id} is ${kindOf.get(r.key)}-${r.key} in the skopo`
        : `RUN ${f}:${i + 1}  ${r.id} is cited but not defined in the skopo`)),
      ...[...line.matchAll(placeholder)].map((m) => `RUN ${f}:${i + 1}  ${m[0]} is still a placeholder; run assign-ids with --also`),
    ]));
}

function lint(dir, skopo) {
  const run = readRun(dir);
  const res = spawnSync(process.execPath, [join(SCRIPTS, 'lint.mjs'), resolve(skopo)], { encoding: 'utf8' });
  // Placeholders stop the lint early; the run's citations are checked only once the skopo has IDs.
  const citations = res.status === 0 || /errors · /.test(res.stdout ?? '') ? runCitations(dir, resolve(skopo)) : [];
  const citationText = citations.length ? `${citations.join('\n')}\nrun data: ${citations.length} citations in questions.md or notes.md to fix\n` : '';
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}${citationText}`;
  const n = run.lintPasses.length + 1;
  writeFileSync(join(dir, 'lint', `${String(n).padStart(2, '0')}.txt`), output);
  const tally = output.match(/(\d+) errors · (\d+) warnings/);
  const codes = Object.fromEntries([...output.matchAll(/^(?:error|warning) ([LS]\d+) /gm)].reduce((m, x) => m.set(x[1], (m.get(x[1]) ?? 0) + 1), new Map()));
  writeRun(dir, { ...run, lintPasses: [...run.lintPasses, { n, at: now(), errors: Number(tally?.[1] ?? -1), warnings: Number(tally?.[2] ?? -1), byCheck: codes, runCitations: citations.length }] });
  process.stdout.write(output);
  process.exit(res.status ?? 1);
}

const words = (text) => text.split(/\s+/).filter(Boolean).length;
const wordsIn = (files) => files.reduce((n, f) => n + words(readFileSync(f, 'utf8')), 0);

function finish(dir, skopo) {
  const root = resolve(skopo);
  const run = readRun(dir);
  const spec = loadSpec(root);
  const product = loadProduct(root);
  const tech = loadTech(root);
  const all = [...spec.statements, ...product.statements, ...tech.statements];
  const byKind = Object.fromEntries('TAWREFD'.split('').map((k) => [k, all.filter((s) => s.kind === k).length]));
  const inventoryPath = join(dir, 'inventory.json');
  const inventory = existsSync(inventoryPath) ? JSON.parse(readFileSync(inventoryPath, 'utf8')) : null;
  const ended = now();
  const phases = run.phases.map((p, i) => {
    const end = run.phases[i + 1]?.startedAt ?? ended;
    return { name: p.name, minutes: Math.round((Date.parse(end) - Date.parse(p.startedAt)) / 6000) / 10 };
  });
  const metrics = {
    skopo: root,
    statements: { total: all.length, byKind, refining: spec.statements.filter((s) => s.refines?.length).length },
    words: {
      spec: wordsIn(mdFiles(root, 'spec')),
      examples: spec.statements.filter((s) => s.kind === 'E').reduce((n, s) => n + words(s.text), 0),
      productBindings: wordsIn(mdFiles(root, join('bindings', 'product'))),
      techBindings: wordsIn(mdFiles(root, join('bindings', 'tech'))),
      rationale: wordsIn(mdFiles(root, 'rationale')),
      readme: existsSync(join(root, 'README.md')) ? words(readFileSync(join(root, 'README.md'), 'utf8')) : 0,
    },
    files: {
      spec: mdFiles(root, 'spec').length,
      bindings: mdFiles(root, 'bindings').length,
      rationale: loadRecords(root).length,
    },
    questions: existsSync(join(dir, 'questions.md')) ? (readFileSync(join(dir, 'questions.md'), 'utf8').match(/^\|\s*\d+\s*\|/gm) ?? []).length : null,
    questionsByCategory: existsSync(join(dir, 'questions.md'))
      ? [...readFileSync(join(dir, 'questions.md'), 'utf8').matchAll(/^\|\s*\d+\s*\|\s*([a-z]+)\s*\|/gm)].reduce((m, x) => ({ ...m, [x[1]]: (m[x[1]] ?? 0) + 1 }), {})
      : null,
    researchReports: existsSync(join(dir, 'research')) ? readdirSync(join(dir, 'research')).filter((f) => f.endsWith('.md')).length : 0,
    source: inventory?.totals ?? null,
    lint: { passes: run.lintPasses.length, last: run.lintPasses.at(-1) ?? null },
    phases,
    totalMinutes: Math.round((Date.parse(ended) - Date.parse(run.startedAt)) / 6000) / 10,
  };
  writeFileSync(join(dir, 'metrics.json'), `${JSON.stringify(metrics, null, 1)}\n`);
  writeRun(dir, { ...run, endedAt: ended });
  const k = metrics.statements.byKind;
  console.log(`${metrics.statements.total} statements: ${k.T} T · ${k.A} A · ${k.R} R · ${k.W} W · ${k.E} E · ${k.F} F · ${k.D} D`);
  console.log(`words: spec ${metrics.words.spec} (examples ${metrics.words.examples}) · product ${metrics.words.productBindings} · tech ${metrics.words.techBindings} · rationale ${metrics.words.rationale}`);
  if (metrics.source) console.log(`from: ${metrics.source.codeLines} code lines and ${metrics.source.docWords} doc words in ${metrics.source.repos} repos`);
  console.log(`lint passes: ${metrics.lint.passes} · questions: ${metrics.questions ?? 'none recorded'} · ${metrics.totalMinutes} minutes`);
  console.log(`written: ${join(dir, 'metrics.json')}`);
}

const [cmd, dir, ...rest] = process.argv.slice(2);
const commands = {
  start: () => start(dir ?? process.cwd()),
  set: () => set(dir, rest),
  phase: () => phase(dir, rest[0], rest.slice(1).join(' ')),
  lint: () => lint(dir, rest[0] ?? fail('lint needs the skopo directory')),
  finish: () => finish(dir, rest[0] ?? fail('finish needs the skopo directory')),
};
if (!commands[cmd]) fail('usage: run.mjs start|set|phase|lint|finish …');
commands[cmd]();
