/**
 * The run the system-findings tests share (openspec change
 * handbook-system-findings): a purpose-built project with three application
 * roots (alpha, beta, gamma) and a tool outside all of them, its candidates, a
 * map that passes check-map, and system findings files that pass
 * check-system-findings. Nothing here is derived from a real project.
 *
 * Seeds of alpha (app1): the start command (a main), the nightly job (a job)
 * and the route table with 5 routes. Beta (app2): the file with 5 routes. Files
 * with 4 routes or fewer are no seed. Gamma (app3) holds library code only, so
 * it has no seed at all. The tool outside every root has a main candidate that
 * belongs to no application.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';

import { clone, runHandbook } from './helpers.mjs';

export const SYSTEM_FORMAT = 'excavator-product-handbook-findings/1';

const routes = (count) => Array.from({ length: count }, (_, i) => `router.get('/r${i + 1}', (req, res) => res.json([${i + 1}]));`).join('\n');
const routeFile = (count) => `const { Router } = require('express');\nconst router = Router();\n\n${routes(count)}\n\nmodule.exports = router;\n`;

export const PROJECT_FILES = Object.freeze({
  'alpha/package.json': '{"name":"alpha","bin":{"alpha":"bin/start.js"},"dependencies":{"express":"^4.18.0","node-schedule":"^2.1.0"}}\n',
  'alpha/bin/start.js': '#!/usr/bin/env node\nconsole.log("start");\n',
  'alpha/src/server.js': routeFile(5),
  'alpha/src/routes/orders.js': routeFile(2),
  'alpha/src/routes/reports.js': routeFile(4),
  'alpha/src/jobs/nightly.js': "const schedule = require('node-schedule');\n\nfunction start(send) {\n  return schedule.scheduleJob('0 3 * * *', () => send('nightly'));\n}\n\nmodule.exports = { start };\n",
  'alpha/src/lib/mailer.js': 'function sendMail(to) {\n  return { to, sent: true };\n}\n\nmodule.exports = { sendMail };\n',
  'beta/package.json': '{"name":"beta","dependencies":{"express":"^4.18.0"}}\n',
  'beta/src/stock.js': routeFile(5),
  'beta/src/small.js': routeFile(4),
  'gamma/package.json': '{"name":"gamma"}\n',
  'gamma/src/util.js': 'function twice(n) {\n  return n * 2;\n}\n\nmodule.exports = { twice };\n',
  'tools/run.js': '#!/usr/bin/env node\nconsole.log("tool");\n',
});

/** The route line number `n` of a route file (the file holds each of them once). */
export const ROUTE = (n) => `router.get('/r${n}', (req, res) => res.json([${n}]));`;
export const MAIL_LINE = 'return { to, sent: true };';
export const JOB_LINE = "return schedule.scheduleJob('0 3 * * *', () => send('nightly'));";
export const SERVER = 'alpha/src/server.js';
export const ORDERS = 'alpha/src/routes/orders.js';
export const REPORTS = 'alpha/src/routes/reports.js';
export const MAILER = 'alpha/src/lib/mailer.js';
export const NIGHTLY = 'alpha/src/jobs/nightly.js';
export const START = 'alpha/bin/start.js';
export const STOCK = 'beta/src/stock.js';
export const SMALL = 'beta/src/small.js';
export const TOOL = 'tools/run.js';

/** The unit id of application `n`. */
export const systemId = (n) => `app${n}.system`;

const ev = (file, passage) => ({ file, passage });

/** The system findings of application 1 that pass check-system-findings (two findings, one unknown). */
export function goodSystemFindings(n = 1) {
  if (n === 2) {
    return {
      format: SYSTEM_FORMAT,
      id: systemId(2),
      findings: [{ category: 'hard-coded', text: 'The stock list is always empty, whatever was stored.', evidence: [ev(STOCK, ROUTE(1))] }],
      unknowns: [],
    };
  }
  return {
    format: SYSTEM_FORMAT,
    id: systemId(1),
    findings: [
      { category: 'notification', text: 'The mail helper reports every message as sent without sending anything.', evidence: [ev(MAILER, MAIL_LINE)] },
      { category: 'time', text: 'The nightly job runs at one fixed hour of the day, whatever the time zone of the reader.', evidence: [ev(NIGHTLY, JOB_LINE)] },
    ],
    unknowns: [{ item: 'Whether a gateway checks the caller before the routes', searched: 'the start command and the route table' }],
  };
}

const mapOf = (idOf) => ({
  format: 'excavator-product-handbook-map/1',
  language: 'English',
  areas: [{ id: 'A1', name: 'Alpha work' }, { id: 'A2', name: 'Beta work' }],
  features: [
    { id: 'F1', name: 'Orders', area: 'A1', reach: 'interface', candidates: [idOf(ORDERS, 4), idOf(ORDERS, 5), ...[4, 5, 6, 7, 8].map((line) => idOf(SERVER, line))], seedFiles: [ORDERS, SERVER] },
    { id: 'F2', name: 'Reports', area: 'A1', reach: 'interface', candidates: [4, 5, 6, 7].map((line) => idOf(REPORTS, line)), seedFiles: [REPORTS] },
    { id: 'F3', name: 'Nightly run', area: 'A1', reach: 'automated', candidates: [idOf(NIGHTLY, 4)], seedFiles: [NIGHTLY] },
    { id: 'F4', name: 'Start command', area: 'A1', reach: 'operator', candidates: [idOf(START, 1)], seedFiles: [START] },
    { id: 'F5', name: 'Stock', area: 'A2', reach: 'interface', candidates: [4, 5, 6, 7, 8].map((line) => idOf(STOCK, line)), seedFiles: [STOCK] },
    { id: 'F6', name: 'Small list', area: 'A2', reach: 'interface', candidates: [4, 5, 6, 7].map((line) => idOf(SMALL, line)), seedFiles: [SMALL] },
  ],
  unassigned: [{ candidate: idOf(TOOL, 1), reason: 'A tool outside every application.' }],
  roles: [],
  names: [],
});

/**
 * A throwaway run over the project above: { base, root, out, candidates, map, writeJson, readJson, readState, run, cleanup,
 * writeSystem, systemDoc, readSystem }. `run(command, ...args)` runs `handbook.mjs <command> <out> ...args --project <root>`;
 * check-map has passed, so state.json exists with every feature planned and no `systemFindings` key.
 */
export function makeSystemRun() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-sys-')));
  const root = join(base, 'project');
  const out = join(base, 'out');
  for (const [path, text] of Object.entries(PROJECT_FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(out, 'entries'), { recursive: true });
  const listed = runHandbook(['candidates', root]);
  if (listed.status !== 0) throw new Error(`candidates failed: ${listed.stderr}`);
  const candidates = JSON.parse(listed.stdout);
  writeFileSync(join(out, 'candidates.json'), `${JSON.stringify(candidates, null, 2)}\n`);
  const idOf = (file, line) => {
    const hit = candidates.items.find((item) => item.file === file && item.line === line);
    if (!hit) throw new Error(`no candidate at ${file}:${line}`);
    return hit.id;
  };
  const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const run = {
    base,
    root,
    out,
    candidates,
    map: mapOf(idOf),
    writeJson,
    readJson: (name) => JSON.parse(readFileSync(join(out, name), 'utf-8')),
    readState: () => JSON.parse(readFileSync(join(out, 'state.json'), 'utf-8')),
    writeState: (state) => writeJson(join(out, 'state.json'), state),
    run: (command, ...args) => runHandbook([command, out, ...args, '--project', root]),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
  run.writeSystem = (n = 1, doc = goodSystemFindings(n)) => writeJson(join(out, 'entries', `${systemId(n)}.json`), doc);
  run.systemDoc = (n = 1) => clone(goodSystemFindings(n));
  run.readSystem = (n = 1) => run.readJson(`entries/${systemId(n)}.json`);
  writeJson(join(out, 'map.json'), run.map);
  const checked = run.run('check-map');
  if (checked.status !== 0) throw new Error(`the system fixture map failed check-map:\n${checked.stdout}${checked.stderr}`);
  return run;
}

/** A run whose map passed, registered for cleanup. */
export function systemRun(cleanups) {
  const run = makeSystemRun();
  cleanups.push(run.cleanup);
  return run;
}

/** A run whose app1 system findings passed check-system-findings. */
export function checkedSystemRun(cleanups, n = 1) {
  const run = systemRun(cleanups);
  run.writeSystem(n);
  const result = run.run('check-system-findings', systemId(n));
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return run;
}
