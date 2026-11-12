// O2 (the overview's name) of openspec change handbook-system-name: the
// overview names the system with the value of one candidate of `names`, cites
// the line of that candidate, and says why it has none when it is null;
// check-overview and try-overview refuse the rest and name the place. A name
// that verification removed, and an overview verified before this change, have
// no `name` key and are accepted. Every refusal is paired with a control.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { entryDigest } from '../../../skills/excavator-product-handbook/lib/state.mjs';
import { MARK, makeCheckedMapRun, markedMap, translatedUi, verifyChecked } from './helpers.mjs';
import { NOTIFY_FILE, NOTIFY_LINE, checkedOverviewRun, goodOverview, overviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ev = (file, passage) => ({ file, passage });
const lines = (...rows) => `${rows.join('\n')}\n`;
const MANIFEST = lines('{', '  "name": "Acme Orders",', '  "description": "Acme Orders helps staff"', '}');

/** A run whose project also has a web manifest in public/ (two lines that hold the name) and, optionally, more files. */
function nameRun(adjust, files = {}) {
  return overviewRun(cleanups, (doc, run) => {
    mkdirSync(join(run.root, 'public'), { recursive: true });
    writeFileSync(join(run.root, 'public', 'manifest.json'), MANIFEST);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(run.root, path, '..'), { recursive: true });
      writeFileSync(join(run.root, path), text);
    }
    adjust?.(doc, run);
  });
}
const named = (text, ...evidence) => (doc) => { doc.name = { text, evidence }; };

describe('check-overview: the name', () => {
  it('passes with the value of a candidate and the passage of its line, from a manifest as from package.json', () => {
    expect(nameRun().run('try-overview').lines).toEqual(['overview: ok']);
    const run = nameRun(named('Acme Orders', ev('public/manifest.json', '"name": "Acme Orders",')));
    const result = run.run('try-overview');
    expect(result.status, result.stdout).toBe(0);
  });

  it('refuses a value that is no candidate and names the place and the candidates it could have taken', () => {
    const run = nameRun(named('Acme Portal', ev('public/manifest.json', '"name": "Acme Orders",')));
    const result = run.run('check-overview');
    expect(result.status).toBe(1);
    expect(result.lines.some((line) => /^name\.text: "Acme Portal" is not the value of any name candidate/.test(line) && line.includes('"Acme Orders"') && line.includes('"handbook-fixture"')), result.stdout).toBe(true);
    expect(result.lines.at(-1)).toMatch(/^Next: /);
    expect(run.readJson('state.json').overview.status).toBe('failed');
  });

  it('refuses a value that is only part of a candidate, or a candidate in other letters', () => {
    for (const text of ['Acme', 'acme orders', 'handbook']) {
      const result = nameRun(named(text, ev('public/manifest.json', '"name": "Acme Orders",'))).run('try-overview');
      expect(result.status, text).toBe(1);
      expect(result.stdout, text).toMatch(/^name\.text: .* is not the value of any name candidate/m);
    }
  });

  it('refuses a passage that is another line of the file, even when it holds the value, and accepts the line itself', () => {
    const wrong = nameRun(named('Acme Orders', ev('public/manifest.json', '"description": "Acme Orders helps staff"')));
    const result = wrong.run('try-overview');
    expect(result.status).toBe(1);
    expect(result.lines.some((line) => /^name\.evidence\[0\]: .*public\/manifest\.json:2/.test(line)), result.stdout).toBe(true);
    // The same passage that covers the candidate's line as well is the candidate's line.
    const both = nameRun(named('Acme Orders', ev('public/manifest.json', '"name": "Acme Orders",\n  "description": "Acme Orders helps staff"')));
    expect(both.run('try-overview').status, 'a passage that covers the line').toBe(0);
  });

  it('refuses a passage in another file than the candidate is in', () => {
    const run = nameRun(named('Acme Orders', ev('package.json', '"name": "handbook-fixture",')));
    const result = run.run('try-overview');
    expect(result.status).toBe(1);
    expect(result.lines.some((line) => /^name\.evidence\[0\]: /.test(line) && line.includes('public/manifest.json:2')), result.stdout).toBe(true);
  });

  it('refuses a name with two passages and a name that cites a documentation file', () => {
    const two = nameRun(named('Acme Orders', ev('public/manifest.json', '"name": "Acme Orders",'), ev('package.json', '"name": "handbook-fixture",')));
    const twoResult = two.run('try-overview');
    expect(twoResult.status).toBe(1);
    expect(twoResult.lines.some((line) => /^name\.evidence: must be one passage/.test(line)), twoResult.stdout).toBe(true);
    const doc = nameRun(named('Acme Orders', ev('README.md', 'Acme Orders')), { 'README.md': 'Acme Orders\n' });
    const docResult = doc.run('try-overview');
    expect(docResult.status).toBe(1);
    expect(docResult.lines.some((line) => /^name\.evidence\[0\]: README\.md is a documentation file/.test(line)), docResult.stdout).toBe(true);
  });

  it('refuses a null name when unknowns lists nothing, and accepts it when unknowns says what was looked at', () => {
    const bare = nameRun((doc) => { doc.name = null; doc.unknowns = []; });
    const result = bare.run('check-overview');
    expect(result.status).toBe(1);
    expect(result.lines.some((line) => /^name: is null and unknowns lists nothing/.test(line)), result.stdout).toBe(true);
    const said = nameRun((doc) => { doc.name = null; });
    expect(said.run('try-overview').lines).toEqual(['overview: ok']);
  });

  it('refuses a candidate that still refers to a variable, and takes the value of the .env line it resolves to', () => {
    const title = '<title>%VITE_TITLE%</title>';
    const refused = nameRun(named('%VITE_TITLE%', ev('index.html', title)), { 'index.html': `${title}\n` });
    const result = refused.run('try-overview');
    expect(result.status).toBe(1);
    expect(result.lines.some((line) => /^name\.text: "%VITE_TITLE%" is a reference to a variable/.test(line)), result.stdout).toBe(true);
    const env = { 'index.html': `${title}\n`, '.env': lines('# settings', 'VITE_TITLE=Acme Orders Online') };
    // The .env file and a manifest are cited like any other file of the project.
    const resolved = nameRun(named('Acme Orders Online', ev('.env', 'VITE_TITLE=Acme Orders Online')), env);
    expect(resolved.run('try-overview').lines).toEqual(['overview: ok']);
    const elsewhere = nameRun(named('Acme Orders Online', ev('index.html', title)), env);
    expect(elsewhere.run('try-overview').status, 'the value is at the .env line, not at the title').toBe(1);
  });

  it('quotes the name as the code writes it: a mixed-case word with an underscore passes the reader-text gate', () => {
    const manifest = lines('{', '  "name": "acmePortal_X"', '}');
    const run = nameRun(named('acmePortal_X', ev('public/manifest.json', '"name": "acmePortal_X"')));
    writeFileSync(join(run.root, 'public', 'manifest.json'), manifest);
    const result = run.run('try-overview');
    expect(result.status, result.stdout).toBe(0);
  });

  it('does not run the language check on the name of a run in a language with its own script', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
    run.writeMap(markedMap(run.map));
    expect(run.run('check-map').status).toBe(0);
    writeFileSync(join(run.root, NOTIFY_FILE), `${NOTIFY_LINE}\n`);
    const doc = goodOverview();
    for (const path of [['summary', 0, 'text'], ['audiences', 0, 'who'], ['audiences', 0, 'does'], ['applications', 0, 'name'], ['applications', 0, 'does'], ['integrations', 0, 'use'], ['unknowns', 0, 'item'], ['unknowns', 0, 'searched']]) {
      const holder = path.slice(0, -1).reduce((value, key) => value[key], doc);
      holder[path.at(-1)] = `${MARK}${holder[path.at(-1)]}`;
    }
    run.writeJson(join(run.out, 'entries', 'overview.json'), doc);
    const result = run.run('try-overview');
    expect(result.status, result.stdout).toBe(0);
  });
});

describe('check-overview: the key itself', () => {
  it('a written overview must have the name key, an object or null; a settled one may lack it', () => {
    const run = overviewRun(cleanups, (doc) => { delete doc.name; });
    const result = run.run('check-overview');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('(top level): missing key "name"');
  });

  it('the name must be an object with a text and evidence, or null', () => {
    for (const bad of ['Acme', 3, [], { text: 'x' }, { text: '', evidence: [] }]) {
      const run = overviewRun(cleanups, (doc) => { doc.name = bad; });
      const result = run.run('try-overview');
      expect(result.status, JSON.stringify(bad)).toBe(1);
      expect(result.lines[0], JSON.stringify(bad)).toMatch(/^name/);
    }
  });

});

