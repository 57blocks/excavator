// O1 of openspec change handbook-outline: check-outline rejects each class of bad outline with the line that names it,
// and passes the good one; outline-facts lists every block. Every rejection is a pair: the bad file must exit 1 with its
// line, then the good counterpart (the same run, the file restored) must exit 0.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { clone, makeRun, markedMap, translatedUi, cjk } from './helpers.mjs';
import { BLOCK_IDS, LIST_IDS, TECHNICAL_IDS, goodOutline, outlineWithout, writeOutline } from './outline-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function newRun() {
  const run = makeRun();
  cleanups.push(run.cleanup);
  run.writeMap();
  return run;
}

/** A bad outline (built by `mutate`) must fail with `expected`; the good one then passes. */
function rejects(name, mutate, expected) {
  it(name, () => {
    const run = newRun();
    const outline = goodOutline();
    mutate(outline);
    writeOutline(run, outline);
    const bad = run.run('check-outline');
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(bad.lines.some((line) => expected.test(line)), bad.stdout).toBe(true);
    writeOutline(run);
    const good = run.run('check-outline');
    expect(good.status, `${good.stdout}${good.stderr}`).toBe(0);
  });
}

const chaptersOf = (outline) => outline.parts.flatMap((part) => part.chapters);
const digestOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const snapshot = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => [join(entry.parentPath, entry.name), digestOf(join(entry.parentPath, entry.name))]));

describe('check-outline: the good file', () => {
  it('passes, prints a summary and changes no file', () => {
    const run = newRun();
    writeOutline(run);
    const before = snapshot(run.out);
    const result = run.run('check-outline');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['outline ok: 4 parts, 19 chapters, 0 blocks left out']);
    expect(snapshot(run.out)).toEqual(before);
  });

  it('accepts a block left out with a reason, whatever its view or content', () => {
    const run = newRun();
    writeOutline(run, outlineWithout(['history', 'overview', 'architecture']));
    const result = run.run('check-outline');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['outline ok: 4 parts, 16 chapters, 3 blocks left out']);
  });

  it('knows every block and every list the fixture holds', () => {
    expect(chaptersOf(goodOutline()).map((chapter) => chapter.block ?? chapter.list).sort()).toEqual([...BLOCK_IDS, ...LIST_IDS].sort());
  });
});

describe('check-outline: usage', () => {
  it('a missing outline.json is a usage error, as a missing domains file is', () => {
    const run = newRun();
    const result = run.run('check-outline');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/outline\.json does not exist/);
  });

  it('an outline.json that is not JSON fails with a line', () => {
    const run = newRun();
    rmSync(join(run.out, 'outline.json'), { force: true });
    run.writeJson(join(run.out, 'outline.json'), {});
    const result = run.run('check-outline');
    expect(result.status).toBe(1);
    expect(result.lines.some((line) => /missing key "parts"/.test(line)), result.stdout).toBe(true);
  });

  it('the map must pass first', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeMap({ ...run.map, format: 'wrong' });
    writeOutline(run);
    const result = run.run('check-outline');
    expect(result.status).toBe(1);
    expect(result.lines.at(-1)).toMatch(/^Next: the map must pass check-map/);
  });
});

describe('check-outline: conservation', () => {
  for (const id of [...BLOCK_IDS, ...LIST_IDS]) {
    rejects(`${id} left out of every chapter and of unplaced`, (outline) => {
      for (const part of outline.parts) part.chapters = part.chapters.filter((c) => (c.block ?? c.list) !== id);
      outline.parts = outline.parts.filter((part) => part.chapters.length > 0);
    }, new RegExp(`^${id}: not placed;`));
  }

  rejects('a block placed in two chapters', (outline) => {
    outline.parts[0].chapters.push({ title: 'Again', block: 'history' });
  }, /^history: placed more than once: parts\[0\]\.chapters\[3\] and parts\[3\]\.chapters\[0\]$/);

  rejects('a block in a chapter and in unplaced', (outline) => {
    outline.unplaced.push({ block: 'findings', reason: 'Left out.' });
  }, /^findings: placed more than once: parts\[3\]\.chapters\[1\] and unplaced\[0\]$/);

  rejects('a block listed twice in unplaced', (outline) => {
    outline.parts[3].chapters = outline.parts[3].chapters.filter((c) => c.block !== 'history');
    outline.unplaced.push({ block: 'history', reason: 'Left out.' }, { block: 'history', reason: 'Left out again.' });
  }, /^history: placed more than once: unplaced\[0\] and unplaced\[1\]$/);

  rejects('an id that is not a block', (outline) => {
    outline.parts[0].chapters.push({ title: 'Mystery', block: 'weather' });
  }, /^parts\[0\]\.chapters\[3\]: "weather" is not a block; run outline-facts for the blocks$/);

  rejects('an unknown id in unplaced', (outline) => {
    outline.unplaced.push({ block: 'weather', reason: 'Not a block.' });
  }, /^unplaced\[0\]: "weather" is not a block/);

  rejects('an empty reason', (outline) => {
    outline.parts[3].chapters = outline.parts[3].chapters.filter((c) => c.block !== 'history');
    outline.unplaced.push({ block: 'history', reason: ' ' });
  }, /^unplaced\[0\]\.reason: must be a non-empty string/);

  rejects('a part without chapters', (outline) => {
    outline.parts.push({ title: 'Nothing here', chapters: [] });
  }, /^parts\[4\]: has no chapters/);

  rejects('a block written as a list', (outline) => {
    outline.parts[0].chapters[0] = { title: 'What this product is', list: 'overview' };
  }, /^parts\[0\]\.chapters\[0\]: overview is a block; write it as "block"$/);

  rejects('a list written as a block', (outline) => {
    outline.parts[0].chapters[2] = { title: 'Work areas', block: 'domains' };
  }, /^parts\[0\]\.chapters\[2\]: domains is a list; write it as "list"$/);

  rejects('a chapter with both block and list', (outline) => {
    outline.parts[0].chapters[0].list = 'domains';
  }, /^parts\[0\]\.chapters\[0\]: a chapter has exactly one of "block" and "list"$/);

  rejects('a chapter with neither', (outline) => {
    delete outline.parts[0].chapters[0].block;
  }, /^parts\[0\]\.chapters\[0\]: a chapter has exactly one of "block" and "list"$/);

  it('prints every problem at once', () => {
    const run = newRun();
    const outline = goodOutline();
    outline.parts[0].chapters = [];
    outline.parts[3].chapters.pop();
    outline.unplaced.push({ block: 'weather', reason: 'Nope.' });
    writeOutline(run, outline);
    const result = run.run('check-outline');
    expect(result.status).toBe(1);
    expect(result.lines.length).toBeGreaterThanOrEqual(5);
  });
});

describe('check-outline: shape and language', () => {
  rejects('a missing key', (outline) => {
    delete outline.unplaced;
  }, /missing key "unplaced"/);

  rejects('an unexpected key on a chapter', (outline) => {
    outline.parts[0].chapters[0].note = 'x';
  }, /unexpected key "note"/);

  rejects('a wrong format', (outline) => {
    outline.format = 'excavator-product-handbook-outline/2';
  }, /format: must be/);

  rejects('a language that is not the map\'s', (outline) => {
    outline.language = 'French';
  }, /^language: "French" differs from the map's language "English"$/);
});

describe('check-outline: the same reader-text checks a domain name gets', () => {
  rejects('a code-shaped word in a part title', (outline) => {
    outline.parts[0].title = 'order_status start';
  }, /^parts\[0\]\.title: "order_status" is not allowed in reader text \(underscore identifier\)/);

  rejects('a camel-case word in a chapter title', (outline) => {
    outline.parts[1].chapters[0].title = 'Who uses workBoard';
  }, /^parts\[1\]\.chapters\[0\]\.title: "workBoard" is not allowed in reader text \(camelCase identifier\)/);

  rejects('a code-shaped word in a reason', (outline) => {
    outline.parts[3].chapters = outline.parts[3].chapters.filter((c) => c.block !== 'history');
    outline.unplaced.push({ block: 'history', reason: 'The order_status table is empty.' });
  }, /^unplaced\[0\]\.reason: "order_status" is not allowed in reader text/);

  rejects('a number in a title that no passage holds', (outline) => {
    outline.parts[0].chapters[0].title = 'Top 7 things';
  }, /^parts\[0\]\.chapters\[0\]\.title: number 7 does not occur/);

  describe('in a language with its own script', () => {
    const WRONG = "written only in ASCII letters; the run's language is Chinese; write it in that language (labels quoted from the source stay as they are)";
    const mark = cjk(0x624b, 0x518c);

    function chineseRun() {
      const run = makeRun();
      cleanups.push(run.cleanup);
      run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
      run.writeMap(markedMap(run.map, 'Chinese'));
      return run;
    }

    const marked = () => {
      const outline = clone(goodOutline('Chinese'));
      for (const part of outline.parts) {
        part.title = `${mark}${part.title}`;
        for (const c of part.chapters) c.title = `${mark}${c.title}`;
      }
      return outline;
    };

    it('refuses a title written only in ASCII letters, then accepts it with a letter of the language', () => {
      const run = chineseRun();
      writeOutline(run, marked());
      const good = run.run('check-outline');
      expect(good.status, good.stdout).toBe(0);
      const spoiled = marked();
      spoiled.parts[1].chapters[2].title = 'Plain ASCII';
      writeOutline(run, spoiled);
      const bad = run.run('check-outline');
      expect(bad.status).toBe(1);
      expect(bad.lines).toEqual([`parts[1].chapters[2].title: ${WRONG}`]);
    });

    it('refuses a reason written only in ASCII letters', () => {
      const run = chineseRun();
      const outline = marked();
      outline.parts[3].chapters = outline.parts[3].chapters.filter((c) => c.block !== 'history');
      outline.unplaced.push({ block: 'history', reason: 'Plain ASCII' });
      writeOutline(run, outline);
      const bad = run.run('check-outline');
      expect(bad.status).toBe(1);
      expect(bad.lines).toEqual([`unplaced[0].reason: ${WRONG}`]);
    });
  });
});

describe('outline-facts', () => {
  it('prints one line per block: id, block or list, the views and the default title', () => {
    const run = newRun();
    const result = run.run('outline-facts');
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toHaveLength(BLOCK_IDS.length + LIST_IDS.length);
    const rows = Object.fromEntries(result.lines.map((line) => { const [id, kind, views, title] = line.split('\t'); return [id, { kind, views, title }]; }));
    expect(Object.keys(rows).sort()).toEqual([...BLOCK_IDS, ...LIST_IDS].sort());
    for (const id of LIST_IDS) expect(rows[id].kind).toBe('list');
    for (const id of BLOCK_IDS) expect(rows[id].kind).toBe('block');
    for (const id of [...BLOCK_IDS, ...LIST_IDS]) expect(rows[id].views).toBe(TECHNICAL_IDS.includes(id) ? 'technical' : 'both');
    expect(rows.overview.title).toBe('Overview');
    expect(rows.history.title).toBe('Code health');
  });

  it('prints the titles of the run\'s own fixed text', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
    run.writeMap(markedMap(run.map, 'Chinese'));
    const result = run.run('outline-facts');
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines.find((line) => line.startsWith('overview\t')).split('\t')[3]).toBe(`${cjk(0x624b, 0x518c)}Overview`);
  });

  it('prints no counts and changes no file', () => {
    const run = newRun();
    const before = snapshot(run.out);
    const result = run.run('outline-facts');
    expect(result.lines.some((line) => /\d/.test(line.split('\t').slice(0, 3).join(' ')))).toBe(false);
    expect(snapshot(run.out)).toEqual(before);
  });

  it('needs the map to pass first', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeMap({ ...run.map, format: 'wrong' });
    const result = run.run('outline-facts');
    expect(result.status).toBe(1);
    expect(result.lines.at(-1)).toMatch(/^Next: the map must pass check-map/);
  });
});
