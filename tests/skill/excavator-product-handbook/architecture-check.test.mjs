// Oracle O1 (check half) of openspec change handbook-architecture-chapter: check-architecture and try-architecture accept a good
// chapter and fact sheet, refuse every kind of problem of the fact sheet (all of them in one run), check the chapter with the
// chapter rules, keep their attempts in state.json (three at most) and record nothing for try-architecture; content problems of
// the reader text are notes.
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { GOOD_ARCH_CHAPTER, archRun, clone, goodArchitecture } from './architecture-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const newRun = (options) => {
  const run = archRun(options);
  cleanups.push(run.cleanup);
  return run;
};

describe('check-architecture accepts', () => {
  it('a good chapter and fact sheet, records them as checked and prints the counts', () => {
    const run = newRun();
    const result = run.strict('check-architecture');
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.lines[0]).toBe('architecture: checked');
    expect(result.lines).toContain('Architecture: 6 components, 4 links, 10 citations');
    expect(result.lines.some((line) => line.startsWith('Chapter: 2 sentences'))).toBe(true);
    expect(result.lines.at(-1)).toMatch(/^Notes: 0 /);
    expect(run.state().architecture).toEqual({ status: 'checked', attempts: 1, notes: [] });
  });

  it('a reader text with a code word as a note, not a refusal', () => {
    const run = newRun();
    const doc = goodArchitecture();
    doc.components[1].label = 'web_client';
    run.writeArch(doc);
    const result = run.strict('check-architecture');
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.lines.some((line) => line.startsWith('note: components[1].label code:'))).toBe(true);
    expect(run.state().architecture.notes).toHaveLength(1);
  });

  it('a chapter number that its citation lacks as a note, as the chapter check does', () => {
    const run = newRun();
    run.writeChapter(GOOD_ARCH_CHAPTER.replace('browser client', 'browser client on port 4000'));
    const result = run.strict('check-architecture');
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.lines.some((line) => /^note: chapter\.\d+ .*number: number 4000/.test(line))).toBe(true);
  });
});

describe('try-architecture', () => {
  it('prints architecture: ok for a good pair, after its note lines, and records nothing', () => {
    const run = newRun();
    const before = JSON.stringify(run.state());
    const result = run.strict('try-architecture');
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.lines.at(-1)).toBe('architecture: ok');
    expect(JSON.stringify(run.state())).toBe(before);
  });

  it('lists the problems with a Next line and records nothing; a note does not fail it', () => {
    const run = newRun();
    const doc = goodArchitecture();
    doc.links[0].to = 'c9';
    run.writeArch(doc);
    const result = run.strict('try-architecture');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('links[0].to');
    expect(result.lines.at(-1)).toBe('Next: fix each line above in architecture.json and chapters/architecture.md and run try-architecture again');
    expect(run.state().architecture).toBeUndefined();
  });
});

/** The good file through `mutate` is refused with a line matching `expected`. */
function refuses(name, mutate, expected) {
  it(name, () => {
    const run = newRun();
    const doc = goodArchitecture();
    mutate(doc, run);
    run.writeArch(doc);
    const bad = run.strict('check-architecture');
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(bad.stdout).toMatch(expected);
    expect(bad.lines.at(-1)).toBe('Next: delete the architecture files and re-dispatch it once with the lines above (attempt 2 of 3)');
    expect(run.state().architecture).toMatchObject({ status: 'failed', attempts: 1 });
  });
}

describe('check-architecture refuses', () => {
  refuses('a wrong format', (doc) => { doc.format = 'x/1'; }, /format: must be "excavator-product-handbook-architecture\/1"/);
  refuses('a missing key', (doc) => { delete doc.unknowns; }, /missing key "unknowns"/);
  refuses('an unknown key', (doc) => { doc.extra = 1; }, /unexpected key "extra"/);
  refuses('a kind that is not in the list', (doc) => { doc.components[4].kind = 'cache'; }, /components\[4\]\.kind: "cache" is not a kind/);
  refuses('a repeated component id', (doc) => { doc.components[5].id = 'c1'; }, /components\[5\]\.id: "c1" is used more than once/);
  refuses('an application root that is not a component', (doc) => { doc.components = doc.components.filter((one) => one.id !== 'c4'); doc.links = doc.links.filter((one) => one.from !== 'c4'); }, /application root "apps\/jobs" is not exactly one frontend, backend or library component \(found 0\)/);
  refuses('an application root that two components share', (doc) => { doc.components[3].application = 'apps/api'; }, /application root "apps\/api" is not exactly one frontend, backend or library component \(found 2\)/);
  refuses('an application root that does not exist', (doc) => { doc.components[3].application = 'apps/none'; }, /components\[3\]\.application: "apps\/none" is not an application root/);
  refuses('an application on a component that is not a frontend or backend', (doc) => { doc.components[4].application = 'apps/api'; }, /components\[4\]\.application: only a frontend, a backend or a library has an application root/);
  refuses('a frontend or backend without an application root', (doc) => { delete doc.components[1].application; }, /components\[1\]: a frontend, a backend or a library needs an application root/);
  refuses('a link to an undeclared component', (doc) => { doc.links[1].to = 'c9'; }, /links\[1\]\.to: "c9" is not a declared component/);
  refuses('a link from an undeclared component', (doc) => { doc.links[1].from = 'c9'; }, /links\[1\]\.from: "c9" is not a declared component/);
  refuses('a link from a component to itself', (doc) => { doc.links[1].to = 'c2'; }, /links\[1\]: "c2" is linked to itself/);
  refuses('the same direction of the same pair twice', (doc) => { doc.links.push(clone(doc.links[1])); }, /links\[4\]: c2 -> c3 is already links\[1\]/);
  refuses('a link text longer than 16 characters', (doc) => { doc.links[0].text = 'x'.repeat(17); }, /links\[0\]\.text: 17 characters; at most 16/);
  refuses('a component with no citation', (doc) => { doc.components[0].evidence = []; }, /components\[0\]\.evidence: at least one citation is needed/);
  refuses('a link with no citation', (doc) => { doc.links[0].evidence = []; }, /links\[0\]\.evidence: at least one citation is needed/);
  refuses('a passage that is not in its file', (doc) => { doc.components[0].evidence[0].passage = 'nothing like this'; }, /components\[0\]\.evidence\[0\]: passage not in src\/app\.js/);
  refuses('a file outside the project', (doc) => { doc.links[0].evidence[0].file = '../outside.js'; }, /links\[0\]\.evidence\[0\]: \.\.\/outside\.js leaves the project/);
  refuses('an unknown without its searched text', (doc) => { doc.unknowns = [{ item: 'x' }]; }, /unknowns\[0\]: missing key "searched"/);

  it('a chapter sentence with no citation, naming the chapter file', () => {
    const run = newRun();
    run.writeChapter(GOOD_ARCH_CHAPTER.replace(` (\`apps/api/package.json:1\`)`, ''));
    const bad = run.strict('check-architecture');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/chapters\/architecture\.md line \d+: uncited/);
  });

  it('every problem of both files in one run', () => {
    const run = newRun();
    const doc = goodArchitecture();
    doc.components[4].kind = 'cache';
    doc.links[0].to = 'c9';
    doc.links[2].text = 'x'.repeat(20);
    run.writeArch(doc);
    run.writeChapter(GOOD_ARCH_CHAPTER.replace(` (\`apps/api/package.json:1\`)`, ''));
    const bad = run.strict('check-architecture');
    const problems = bad.lines.filter((line) => !line.startsWith('Next:'));
    expect(problems.length).toBeGreaterThanOrEqual(4);
    expect(bad.stdout).toContain('is not a kind');
    expect(bad.stdout).toContain('is not a declared component');
    expect(bad.stdout).toContain('at most 16');
    expect(bad.stdout).toContain('chapters/architecture.md');
  });

  it('a project that has the files missing: lane-wrote-nothing', () => {
    const run = newRun({ write: false });
    const bad = run.strict('check-architecture');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('architecture: lane-wrote-nothing');
    expect(run.state().architecture).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('a chapter without its fact sheet', () => {
    const run = newRun({ write: false });
    run.writeChapter();
    const bad = run.strict('check-architecture');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('architecture.json is missing');
  });
});

describe('the attempts of check-architecture', () => {
  it('allows three, then keeps the failure and says so', () => {
    const run = newRun();
    const doc = goodArchitecture();
    doc.links[0].to = 'c9';
    run.writeArch(doc);
    const lasts = [1, 2, 3].map(() => run.strict('check-architecture').lines.at(-1));
    expect(lasts).toEqual([
      'Next: delete the architecture files and re-dispatch it once with the lines above (attempt 2 of 3)',
      'Next: delete the architecture files and re-dispatch it once with the lines above (attempt 3 of 3)',
      'Next: architecture stays failed (3 of 3 attempts)',
    ]);
    run.writeArch();
    const after = run.strict('check-architecture');
    expect(after.status).toBe(1);
    expect(after.lines.at(-1)).toBe('Next: architecture stays failed (3 of 3 attempts)');
    expect(run.state().architecture).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('records a pass after a failure with the attempt count', () => {
    const run = newRun();
    const doc = goodArchitecture();
    doc.links[0].to = 'c9';
    run.writeArch(doc);
    expect(run.strict('check-architecture').status).toBe(1);
    run.writeArch();
    expect(run.strict('check-architecture').status).toBe(0);
    expect(run.state().architecture).toMatchObject({ status: 'checked', attempts: 2 });
  });

  it('keeps the ui.json instruction of a run in another language whose table is missing', () => {
    const run = newRun();
    const map = run.readJson('map.json');
    map.language = 'Chinese';
    run.writeMap(map);
    const bad = run.strict('check-architecture');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('Next: write ui.json first');
  });

  it('needs the state that check-map writes', () => {
    const run = newRun();
    rmSync(join(run.out, 'state.json'));
    const bad = run.strict('check-architecture');
    expect(bad.status).toBe(2);
  });
});
