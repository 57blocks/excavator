/**
 * Shared helpers for the excavator-product-handbook script tests: run
 * `handbook.mjs` as a CLI and build a throwaway run (a copy of the synthetic
 * fixture project, an out directory with its candidates.json, and a map and an
 * entry that pass every check). Every project here is purpose-built; nothing
 * is derived from a real project.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');
export const HANDBOOK_SCRIPT = join(repoRoot, 'skills/excavator-product-handbook/handbook.mjs');
export const SHIPPED_UI = join(repoRoot, 'skills/excavator-product-handbook/ui-strings.json');
export const FIXTURE_PROJECT = join(repoRoot, 'tests/fixtures/product-handbook/project');

/** Run `node handbook.mjs <args>`; returns { status, stdout, stderr, lines } (lines: the non-empty stdout lines). */
export function runHandbook(args, options = {}) {
  const result = spawnSync(process.execPath, [HANDBOOK_SCRIPT, ...args], { encoding: 'utf-8', ...options });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, lines: result.stdout.split('\n').filter((line) => line !== '') };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const ev = (file, passage) => ({ file, passage });

let candidatesCache = null;
/** The fixture's candidates, listed once through the CLI. */
function fixtureCandidates() {
  if (candidatesCache === null) {
    const out = runHandbook(['candidates', FIXTURE_PROJECT]);
    if (out.status !== 0) throw new Error(`candidates failed: ${out.stderr}`);
    candidatesCache = JSON.parse(out.stdout);
  }
  return candidatesCache;
}

/** The map that passes check-map on the fixture, with candidate ids filled in. */
export function goodMap(idOf) {
  return {
    format: 'excavator-product-handbook-map/1',
    language: 'English',
    areas: [
      { id: 'A1', name: 'Order handling' },
      { id: 'A2', name: 'Automatic work' },
    ],
    features: [
      {
        id: 'F1', name: 'Orders', area: 'A1', reach: 'menu', label: 'Orders',
        evidence: [ev('src/menu.js', "{ label: 'Orders', path: '/orders' },")],
        candidates: [idOf('src/routes/orders.js', 5), idOf('src/routes/orders.js', 6)],
        seedFiles: ['src/routes/orders.js', 'src/menu.js', 'src/forms/order-form.js'],
      },
      {
        id: 'F2', name: 'Archive', area: 'A1', reach: 'link', label: 'Archive',
        evidence: [ev('src/menu.js', "// { label: 'Archive', path: '/archive' },")],
        candidates: [idOf('src/routes/archive.js', 5)],
        seedFiles: ['src/routes/archive.js'],
      },
      {
        id: 'F3', name: 'Reminders', area: 'A2', reach: 'automated',
        candidates: [idOf('src/jobs/reminders.js', 4)],
        seedFiles: ['src/jobs/reminders.js'],
      },
      {
        id: 'F4', name: 'Admin tool', area: 'A2', reach: 'operator',
        candidates: [idOf('bin/admin.js', 1)],
        seedFiles: ['bin/admin.js'],
      },
      {
        id: 'F5', name: 'Orders', area: 'A2', reach: 'interface',
        candidates: [idOf('src/routes/orders.js', 7)],
        seedFiles: ['src/routes/orders.js'],
      },
    ],
    unassigned: [{ candidate: idOf('src/app.js', 8), reason: 'A health check that no reader uses.' }],
    roles: [
      { label: 'Clerk', evidence: [ev('src/roles.js', "const ROLES = ['Clerk', 'Approver'];")] },
      { label: 'Approver', evidence: [ev('src/roles.js', "const ROLES = ['Clerk', 'Approver'];")] },
    ],
    names: [{ label: 'WorkBoard', evidence: [ev('src/menu.js', "{ label: 'WorkBoard', path: '/board' },")] }],
  };
}

/** The entry of F1 that passes check-entry: numbers with and without thousands commas, labels, rules on both sides. */
export function goodEntry() {
  const form = 'src/forms/order-form.js';
  const nameField = "{ label: 'Customer Name', required: true },";
  const countField = "{ label: 'Item Count', max: 35000 },";
  return {
    format: 'excavator-product-handbook-entry/1',
    id: 'F1',
    purpose: { text: 'Staff place new orders for customers.', evidence: [ev(form, "title: 'New Order',")] },
    who: [{ role: 'Clerk', can: 'Create an order.', evidence: [ev('src/roles.js', "const ROLES = ['Clerk', 'Approver'];")] }],
    where: [
      { label: 'Orders', evidence: [ev('src/menu.js', "{ label: 'Orders', path: '/orders' },")] },
      { label: 'New Order', evidence: [ev(form, "title: 'New Order',")] },
    ],
    screens: [{
      name: 'New Order',
      evidence: [ev(form, "title: 'New Order',")],
      fields: [
        {
          label: 'Customer Name',
          evidence: [ev(form, nameField)],
          rules: [{ side: 'frontend', text: 'The field is required.', evidence: [ev(form, nameField)] }],
        },
        {
          label: 'Item Count',
          evidence: [ev(form, countField)],
          rules: [
            { side: 'backend', text: 'At most 35,000 items.', evidence: [ev(form, countField)] },
            { side: 'frontend', text: 'An upload may hold up to 100,000 bytes.', evidence: [ev(form, 'const MAX_UPLOAD = 100_000;')] },
          ],
        },
      ],
    }],
    operations: [{
      name: 'Place an order',
      sentences: [
        { text: 'The clerk fills in the customer name.', evidence: [ev(form, nameField)] },
        { text: 'The item count is limited to 35000.', evidence: [ev(form, countField)] },
      ],
    }],
    states: [
      { label: 'Draft', meaning: 'The order is not sent yet.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] },
      { label: 'Submitted', meaning: 'The order was sent.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] },
    ],
    notifications: [],
    automatic: [],
    unknowns: [{ item: 'Who approves a large order', searched: 'the order form and the routes of the orders area' }],
  };
}

/**
 * A throwaway run: { root, out, candidates, idOf, map, entry, writeMap, writeEntry, writeJson, readJson,
 * run, cleanup }. `root` is a copy of the fixture project; `out` holds candidates.json already.
 */
export function makeRun() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-')));
  const root = join(base, 'project');
  const out = join(base, 'out');
  cpSync(FIXTURE_PROJECT, root, { recursive: true });
  mkdirSync(join(out, 'entries'), { recursive: true });
  const listed = clone(fixtureCandidates());
  listed.projectRoot = root;
  writeFileSync(join(out, 'candidates.json'), `${JSON.stringify(listed, null, 2)}\n`);
  const idOf = (file, line) => {
    const hit = listed.items.find((item) => item.file === file && item.line === line);
    if (!hit) throw new Error(`no candidate at ${file}:${line}`);
    return hit.id;
  };
  const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const run = {
    base,
    root,
    out,
    candidates: listed,
    idOf,
    map: goodMap(idOf),
    entry: goodEntry(),
    writeJson,
    readJson: (name) => JSON.parse(readFileSync(join(out, name), 'utf-8')),
    writeMap: (map = run.map) => writeJson(join(out, 'map.json'), map),
    writeEntry: (id = 'F1', entry = run.entry) => writeJson(join(out, 'entries', `${id}.json`), entry),
    run: (command, ...args) => runHandbook([command, out, ...args, '--project', root]),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
  return run;
}

/** Run check-map on a fresh good run and return it, so a test starts from a map that passed. */
export function makeCheckedMapRun() {
  const run = makeRun();
  run.writeMap();
  const result = run.run('check-map');
  if (result.status !== 0) throw new Error(`the good map failed check-map:\n${result.stdout}${result.stderr}`);
  return run;
}

/**
 * Slice a checked feature, write the two verdict files of every part of its
 * verify files (`part-<n>.a.json` judges each item with `decide(item)`, `.b`
 * with `decideB(item)`, by default the same; a verdict word or
 * `{ verdict, reason }`, default verified), and record them with `verdicts`.
 * Returns the `verdicts` result. Round 2 judges the items its verify files hold.
 */
export function judge(run, id = 'F1', round = 1, decide = () => 'verified', decideB = decide) {
  const sliced = run.run('slices', id, ...(round === 2 ? ['--round', '2'] : []));
  if (sliced.status !== 0) throw new Error(`slices failed:\n${sliced.stdout}${sliced.stderr}`);
  const verifyDir = join(run.out, 'verify', `round-${round}`, id);
  const dir = join(run.out, 'verdicts', `round-${round}`, id);
  mkdirSync(dir, { recursive: true });
  const { parts } = JSON.parse(readFileSync(join(verifyDir, 'part-1.json'), 'utf-8'));
  for (let part = 1; part <= parts; part += 1) {
    const verify = JSON.parse(readFileSync(join(verifyDir, `part-${part}.json`), 'utf-8'));
    for (const [letter, decider] of [['a', decide], ['b', decideB]]) {
      const verdicts = verify.items.map((item) => {
        const given = decider(item);
        const verdict = typeof given === 'string' ? { verdict: given } : given;
        return { id: item.id, verdict: verdict.verdict, reason: verdict.reason ?? `The code shown decides ${item.id}.` };
      });
      writeFileSync(join(dir, `part-${part}.${letter}.json`), `${JSON.stringify({ verdicts }, null, 2)}\n`);
    }
  }
  return run.run('verdicts', id, '--round', String(round));
}

/** Settle a checked feature with every item verified by both verifiers: it ends `confirmed`, not yet traced; throws otherwise. */
export function confirmChecked(run, id = 'F1') {
  const result = judge(run, id);
  if (result.status !== 0) throw new Error(`verdicts failed:\n${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Trace a confirmed feature: write the trace files with `trace`, two verdict
 * files per part (`part-<n>.a.json` judges each item with `decide(item)`, `.b`
 * with `decideB(item)`, by default the same; a verdict word or
 * `{ verdict, reason, at }`, default `holds`), and record them with
 * `trace-verdicts`. Returns that result. `edit(part, verdicts)` may change the
 * verdict list of file `a` of a part before it is written, `editB` that of `b`.
 */
export function traceFeature(run, id = 'F1', decide = () => 'holds', edit = () => {}, decideB = decide, editB = () => {}) {
  const traced = run.run('trace', id);
  if (traced.status !== 0) throw new Error(`trace failed:\n${traced.stdout}${traced.stderr}`);
  const traceDir = join(run.out, 'trace', id);
  const dir = join(run.out, 'trace-verdicts', id);
  mkdirSync(dir, { recursive: true });
  const { parts } = JSON.parse(readFileSync(join(traceDir, 'part-1.json'), 'utf-8'));
  for (let part = 1; part <= parts; part += 1) {
    const file = JSON.parse(readFileSync(join(traceDir, `part-${part}.json`), 'utf-8'));
    for (const [letter, decider, editor] of [['a', decide, edit], ['b', decideB, editB]]) {
      const verdicts = file.items.map((item) => {
        const given = decider(item);
        const verdict = typeof given === 'string' ? { verdict: given } : given;
        return { id: item.id, ...verdict, reason: verdict.reason ?? `Nothing in the code disagrees with ${item.id}.` };
      });
      editor(part, verdicts);
      writeFileSync(join(dir, `part-${part}.${letter}.json`), `${JSON.stringify({ verdicts }, null, 2)}\n`);
    }
  }
  return run.run('trace-verdicts', id);
}

/** Verify a checked feature end to end: both verifiers confirm every item and the tracer finds no counter-evidence. Throws when it does not end verified. */
export function verifyChecked(run, id = 'F1') {
  confirmChecked(run, id);
  const result = traceFeature(run, id);
  if (result.status !== 0) throw new Error(`trace-verdicts failed:\n${result.stdout}${result.stderr}`);
  return result;
}

/** Non-ASCII text from code points, so that test sources hold only ASCII. */
export const cjk = (...points) => String.fromCodePoint(...points);
/** A CJK mark (two characters) put in front of every narrative text of a non-Latin test run. */
export const MARK = cjk(0x624b, 0x518c);

const markText = (text, mark) => `${mark}${text}`;

/**
 * A translation of the shipped table for the language `language`: every value
 * gets `mark(index)` in front (`mark` returns '' to leave a value alone), the
 * placeholders stay. The default mark is a CJK mark on every value.
 */
export function translatedUi(language = 'Chinese', mark = () => MARK) {
  const table = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));
  table.language = language;
  Object.keys(table.strings).forEach((key, index) => {
    table.strings[key] = markText(table.strings[key], mark(index));
  });
  return table;
}

/** A table for a language written in Latin letters: fewer than half of the values hold an accented letter. */
export const latinUi = (language = 'French') => translatedUi(language, (index) => (index % 4 === 0 ? cjk(0xe9) : ''));

/** The good map with the texts a model writes (area names without evidence, feature names without a label, unassigned reasons) marked. */
export function markedMap(map, language = 'Chinese', mark = MARK) {
  const marked = clone(map);
  marked.language = language;
  for (const area of marked.areas) if (area.evidence === undefined) area.name = markText(area.name, mark);
  for (const feature of marked.features) if (feature.label === undefined) feature.name = markText(feature.name, mark);
  for (const entry of marked.unassigned) entry.reason = markText(entry.reason, mark);
  return marked;
}

/** The good entry with every narrative text marked. */
export function markedEntry(entry, mark = MARK) {
  const marked = clone(entry);
  marked.purpose.text = markText(marked.purpose.text, mark);
  for (const who of marked.who) who.can = markText(who.can, mark);
  for (const screen of marked.screens) for (const field of screen.fields) for (const rule of field.rules) rule.text = markText(rule.text, mark);
  for (const operation of marked.operations) {
    operation.name = markText(operation.name, mark);
    for (const sentence of operation.sentences) sentence.text = markText(sentence.text, mark);
  }
  for (const state of marked.states) state.meaning = markText(state.meaning, mark);
  for (const n of marked.notifications) for (const key of ['trigger', 'recipient', 'channel', 'content']) n[key] = markText(n[key], mark);
  for (const a of marked.automatic) for (const key of ['when', 'effect']) a[key] = markText(a[key], mark);
  for (const u of marked.unknowns) for (const key of ['item', 'searched']) u[key] = markText(u[key], mark);
  return marked;
}

/** Set `value` at a dotted path of an object, e.g. set(map, 'features.0.label', 'x'). */
export function set(object, path, value) {
  const keys = path.split('.');
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key];
  target[keys.at(-1)] = value;
  return object;
}

export { clone };
