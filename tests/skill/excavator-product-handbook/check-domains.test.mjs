// O1 of openspec change handbook-map-by-domain: check-domains rejects each
// class of bad domains file with the line that names it, and passes the good
// one; a passing file is kept on a resume, and a file that no longer fits a
// changed map is reported. Every rejection is a pair: the bad file must exit 1
// with its line, then the good counterpart (the same run, the file restored)
// must exit 0.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, makeRun, markedDomains, markedMap, translatedUi } from './helpers.mjs';

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

/** A bad domains file (built by `mutate`) must fail with `expected`; the good file then passes. */
function rejects(name, mutate, expected) {
  it(name, () => {
    const run = newRun();
    const domains = clone(run.domains);
    mutate(domains, run);
    run.writeDomains(domains);
    const bad = run.run('check-domains');
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(bad.lines.some((line) => expected.test(line)), bad.stdout).toBe(true);
    run.writeDomains();
    const good = run.run('check-domains');
    expect(good.status, `${good.stdout}${good.stderr}`).toBe(0);
  });
}

const digestOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const snapshot = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => [join(entry.parentPath, entry.name), digestOf(join(entry.parentPath, entry.name))]));

describe('check-domains: the good file', () => {
  it('passes, prints a summary and changes no file', () => {
    const run = newRun();
    run.writeDomains();
    const before = snapshot(run.out);
    const result = run.run('check-domains');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['domains ok: 2 domains, 5 features']);
    expect(snapshot(run.out)).toEqual(before);
  });

  it('lets a domain cross the areas of the map: the map is not read as a grouping', () => {
    const run = newRun();
    const areaOf = (id) => run.map.features.find((feature) => feature.id === id).area;
    expect(new Set(run.domains.domains[0].features.map(areaOf)).size).toBeGreaterThan(1);
    run.writeDomains();
    expect(run.run('check-domains').status).toBe(0);
  });

  it('accepts a domain name quoted from the source when it carries evidence, as an area name does', () => {
    const run = newRun();
    const domains = clone(run.domains);
    domains.domains[0].name = 'Orders';
    domains.domains[0].evidence = [{ file: 'src/menu.js', passage: "{ label: 'Orders', path: '/orders' }," }];
    run.writeDomains(domains);
    const result = run.run('check-domains');
    expect(result.status, result.stdout).toBe(0);
  });
});

describe('check-domains: conservation', () => {
  rejects('a feature left out of every domain', (domains) => {
    domains.domains[0].features = ['F1', 'F2'];
  }, /^F5: not in any domain \(Orders\)$/);

  rejects('a feature in two domains', (domains) => {
    domains.domains[1].features.push('F2');
  }, /^F2: in more than one domain: D1 and D2$/);

  rejects('a feature listed twice in one domain', (domains) => {
    domains.domains[0].features.push('F1');
  }, /^F1: listed more than once in D1$/);

  rejects('an id that is not a feature of the map', (domains) => {
    domains.domains[1].features.push('F99');
  }, /^domains\[1\]\.features\[2\]: "F99" is not a feature of the map$/);

  rejects('an empty domain', (domains) => {
    domains.domains.push({ id: 'D3', name: 'Nothing yet', features: [] });
  }, /^domains\[2\]: D3 has no features/);

  it('names every problem, one per line, not only the first', () => {
    const run = newRun();
    const domains = clone(run.domains);
    domains.domains[0].features = ['F1'];
    domains.domains[1].features.push('F99');
    run.writeDomains(domains);
    const result = run.run('check-domains');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/^F2: not in any domain/),
      expect.stringMatching(/^F5: not in any domain/),
      expect.stringMatching(/"F99" is not a feature/),
    ]));
  });
});

describe('check-domains: ids and shape', () => {
  rejects('an id that skips a number', (domains) => {
    domains.domains[1].id = 'D3';
  }, /^domains\[1\]\.id: "D3" is out of order; ids run D1, D2, \.\.\. without a gap, so this one is D2$/);

  rejects('ids that do not start at D1', (domains) => {
    domains.domains[0].id = 'D2';
    domains.domains[1].id = 'D3';
  }, /^domains\[0\]\.id: "D2" is out of order/);

  rejects('an id used twice', (domains) => {
    domains.domains[1].id = 'D1';
  }, /^domains: id D1 is used more than once$/);

  rejects('a missing key', (domains) => {
    delete domains.format;
  }, /missing key "format"/);

  rejects('an unexpected key on a domain', (domains) => {
    domains.domains[0].area = 'A1';
  }, /domains\[0\]: unexpected key "area"/);

  rejects('a features list that is not an array', (domains) => {
    domains.domains[0].features = 'F1';
  }, /domains\[0\]\.features: must be an array/);

  it('reports a file that is not JSON, and exits 2 for a missing file', () => {
    const run = newRun();
    writeFileSync(join(run.out, 'domains.json'), '{ not json');
    const bad = run.run('check-domains');
    expect(bad.status).toBe(1);
    expect(bad.lines[0]).toMatch(/^domains\.json is not valid JSON/);
    const missing = newRun().run('check-domains');
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/domains\.json does not exist/);
  });
});

describe('check-domains: the same reader-text and language checks an area name gets', () => {
  rejects('a code-shaped word in a domain name', (domains) => {
    domains.domains[0].name = 'order_status handling';
  }, /^domains\[0\]\.name: "order_status" is not allowed in reader text \(underscore identifier\)/);

  rejects('a camel-case word in a domain name', (domains) => {
    domains.domains[1].name = 'System workBoard';
  }, /^domains\[1\]\.name: "workBoard" is not allowed in reader text \(camelCase identifier\)/);

  rejects('a number in a domain name that no passage holds', (domains) => {
    domains.domains[0].name = 'Order handling 7';
  }, /^domains\[0\]\.name: number 7 does not occur in this item's passages/);

  rejects('a name quoted as a label that is not in its passage', (domains) => {
    domains.domains[0].name = 'Orders';
    domains.domains[0].evidence = [{ file: 'src/menu.js', passage: "{ label: 'Archive', path: '/archive' }," }];
  }, /^domains\[0\]\.name: label "Orders" does not occur in this item's passages/);

  rejects('a citation whose passage is not in the file', (domains) => {
    domains.domains[0].name = 'Orders';
    domains.domains[0].evidence = [{ file: 'src/menu.js', passage: 'text that is not in the menu file' }];
  }, /^domains\[0\]\.evidence\[0\]: passage not in src\/menu\.js$/);

  rejects('a language that is not the map\'s', (domains) => {
    domains.language = 'French';
  }, /^language: "French" differs from the map's language "English"$/);

  describe('in a language with its own script', () => {
    const WRONG = "written only in ASCII letters; the run's language is Chinese; write it in that language (labels quoted from the source stay as they are)";

    function chineseRun() {
      const run = makeRun();
      cleanups.push(run.cleanup);
      run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
      run.writeMap(markedMap(run.map, 'Chinese'));
      return run;
    }

    it('refuses a domain name written only in ASCII letters, then accepts it with a letter of the language', () => {
      const run = chineseRun();
      run.writeDomains(Object.assign(markedDomains(run.domains), { language: 'Chinese' }));
      const good = run.run('check-domains');
      expect(good.status, good.stdout).toBe(0);
      const spoiled = markedDomains(run.domains);
      spoiled.domains[1].name = 'System upkeep';
      run.writeDomains(spoiled);
      const bad = run.run('check-domains');
      expect(bad.status).toBe(1);
      expect(bad.lines).toEqual([`domains[1].name: ${WRONG}`]);
    });

    it('does not ask a name quoted from the source for a letter of the language', () => {
      const run = chineseRun();
      const domains = markedDomains(run.domains);
      domains.domains[0].name = 'Orders';
      domains.domains[0].evidence = [{ file: 'src/menu.js', passage: "{ label: 'Orders', path: '/orders' }," }];
      run.writeDomains(domains);
      const result = run.run('check-domains');
      expect(result.status, result.stdout).toBe(0);
    });

    it('refuses to check without a checked fixed-text table, like check-map', () => {
      const run = chineseRun();
      run.writeDomains(markedDomains(run.domains));
      writeFileSync(join(run.out, 'ui.json'), '{}');
      const result = run.run('check-domains');
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/Next: /);
    });
  });
});

describe('check-domains: the map comes first, and a resume keeps a file that still fits', () => {
  it('prints the map\'s own problems when the map does not pass', () => {
    const run = newRun();
    run.writeDomains();
    const map = clone(run.map);
    map.features[4].candidates = [];
    run.writeMap(map);
    const result = run.run('check-domains');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/not in any feature and not in unassigned/);
    expect(result.lines.at(-1)).toMatch(/^Next: /);
  });

  it('keeps a passing file: it passes again, byte for byte, and nothing else changes (the resume reads it and skips the phase)', () => {
    const run = newRun();
    run.writeDomains();
    const before = snapshot(run.out);
    for (let i = 0; i < 2; i += 1) expect(run.run('check-domains').status).toBe(0);
    expect(snapshot(run.out)).toEqual(before);
  });

  it('adds the file to an output that has none without touching the map or the entries', () => {
    const run = newRun();
    expect(run.run('check-map').status).toBe(0);
    run.writeEntry();
    const before = snapshot(run.out);
    expect(run.run('check-domains').status).toBe(2);
    run.writeDomains();
    expect(run.run('check-domains').status).toBe(0);
    const after = snapshot(run.out);
    const added = Object.keys(after).filter((path) => !(path in before));
    expect(added).toEqual([join(run.out, 'domains.json')]);
    for (const [path, digest] of Object.entries(before)) expect(after[path], path).toBe(digest);
  });

  it('reports a file that no longer fits a map that was written again', () => {
    const run = newRun();
    run.writeDomains();
    expect(run.run('check-domains').status).toBe(0);
    const map = clone(run.map);
    map.features[4].id = 'F6';
    run.writeMap(map);
    const result = run.run('check-domains');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/^F6: not in any domain/),
      expect.stringMatching(/"F5" is not a feature of the map/),
    ]));
  });
});
