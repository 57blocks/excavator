// Oracle O2 of openspec change product-handbook-map: check-map rejects each
// class of bad map with the line that names it, and passes the good map.
// Every case is a pair: the bad fixture must exit 1 with its line, then the
// good counterpart (the same run, the map restored) must exit 0.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, makeRun, runHandbook, set } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function newRun() {
  const run = makeRun();
  cleanups.push(run.cleanup);
  return run;
}

/** A bad map (built by `mutate`, which may also prepare files) must fail with `expected`; the good map then passes. */
function rejects(name, mutate, expected) {
  it(name, () => {
    const run = newRun();
    const map = clone(run.map);
    mutate(map, run);
    run.writeMap(map);
    const bad = run.run('check-map');
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(bad.stdout).toMatch(expected);
    run.writeMap();
    const good = run.run('check-map');
    expect(good.status, `${good.stdout}${good.stderr}`).toBe(0);
  });
}

describe('check-map: the good map', () => {
  it('passes, prints a summary, and creates state.json with every feature planned', () => {
    const run = newRun();
    run.writeMap();
    const result = run.run('check-map');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['map ok: 2 areas, 5 features, 7 candidates (1 unassigned)']);
    const state = run.readJson('state.json');
    expect(state.format).toBe('excavator-product-handbook-state/1');
    expect(state.features).toEqual(Object.fromEntries(['F1', 'F2', 'F3', 'F4', 'F5'].map((id) => [id, { status: 'planned', attempts: 0 }])));
  });

  it('keeps two features with the same name in different areas apart (identity fixture)', () => {
    const run = newRun();
    expect(run.map.features.filter((feature) => feature.name === 'Orders').map((feature) => feature.area)).toEqual(['A1', 'A2']);
    run.writeMap();
    expect(run.run('check-map').status).toBe(0);
  });
});

describe('check-map: conservation', () => {
  rejects('a candidate left out of every feature', (map) => {
    map.features[4].candidates = [];
  }, /c7: not in any feature and not in unassigned \(route src\/routes\/orders\.js:7\)/);

  rejects('a candidate assigned to two features', (map, run) => {
    map.features[4].candidates.push(run.idOf('src/routes/orders.js', 5));
  }, /c5: assigned more than once: F1 and F5/);

  rejects('a candidate in a feature and in unassigned', (map, run) => {
    map.unassigned.push({ candidate: run.idOf('src/jobs/reminders.js', 4), reason: 'Left out on purpose.' });
  }, /c3: assigned more than once: F3 and unassigned/);

  rejects('a candidate listed twice by one feature', (map, run) => {
    map.features[0].candidates.push(run.idOf('src/routes/orders.js', 5));
  }, /c5: assigned more than once: F1 and F1/);

  rejects('a candidate id that candidates.json does not have', (map) => {
    map.features[2].candidates.push('c99');
  }, /c99: is not a candidate in candidates\.json \(listed by F3\)/);

  it('names every missing candidate, not just the first', () => {
    const run = newRun();
    const map = clone(run.map);
    map.features[0].candidates = [];
    run.writeMap(map);
    const bad = run.run('check-map');
    expect(bad.status).toBe(1);
    expect(bad.lines.filter((line) => /not in any feature/.test(line))).toHaveLength(2);
  });
});

describe('check-map: reach, labels and structure', () => {
  rejects('a menu feature whose label is not in its evidence', (map) => {
    map.features[0].label = 'Orderz';
  }, /features\[0\]\.label: label "Orderz" does not occur in this item's passages \(src\/menu\.js\)/);

  rejects('a link feature whose label is not in its evidence', (map) => {
    map.features[1].label = 'Records';
  }, /features\[1\]\.label: label "Records" does not occur/);

  rejects('a menu feature with no evidence', (map) => {
    delete map.features[0].evidence;
  }, /features\[0\]: a menu feature needs evidence \(F1\)/);

  rejects('a link feature with no label', (map) => {
    delete map.features[1].label;
  }, /features\[1\]: a link feature needs a label \(F2\)/);

  rejects('a role whose label is not in its evidence', (map) => {
    map.roles[0].label = 'Cashier';
  }, /roles\[0\]\.label: label "Cashier" does not occur/);

  rejects('a feature in an area that does not exist', (map) => {
    map.features[2].area = 'A9';
  }, /features\[2\]\.area: "A9" is not an area id/);

  rejects('a feature id used twice', (map) => {
    map.features[4].id = 'F1';
  }, /features: id F1 is used more than once/);

  rejects('an id that cannot be a file name', (map) => {
    map.features[4].id = '../F5';
  }, /features\[4\]\.id: "\.\.\/F5" is not a plain id/);

  rejects('a reach that is not one of the five', (map) => {
    map.features[2].reach = 'cron';
  }, /features\[2\]\.reach: must be one of menu, link, automated, interface, operator, found "cron"/);

  rejects('an extra key', (map) => {
    map.features[2].priority = 'high';
  }, /features\[2\]: unexpected key "priority"/);

  rejects('a missing top-level key', (map) => {
    delete map.names;
  }, /\(top level\): missing key "names"/);

  rejects('a wrong type', (map) => {
    map.features[2].candidates = 'c3';
  }, /features\[2\]\.candidates: must be an array, found a string/);

  rejects('empty evidence', (map) => {
    map.roles[1].evidence = [];
  }, /roles\[1\]\.evidence: must have at least 1 item/);
});

describe('check-map: seed files', () => {
  rejects('a seed file that does not exist', (map) => {
    map.features[0].seedFiles.push('src/nope.js');
  }, /features\[0\]\.seedFiles\[3\]: src\/nope\.js is not a file in the project/);

  rejects('a seed file that leaves the project', (map) => {
    map.features[0].seedFiles.push('../x.js');
  }, /features\[0\]\.seedFiles\[3\]: \.\.\/x\.js leaves the project/);
});

describe('check-map: citations', () => {
  rejects('a passage that is not in the file', (map) => {
    map.features[0].evidence[0].passage = "{ label: 'Orders', path: '/invoices' },";
  }, /features\[0\]\.evidence\[0\]: passage not in src\/menu\.js/);

  rejects('a passage that occurs twice in the file', (map) => {
    // "ROLES" is in src/roles.js twice (the constant and the export).
    map.roles[0].evidence[0].passage = 'ROLES';
  }, /roles\[0\]\.evidence\[0\]: passage occurs 2 times in src\/roles\.js; quote more of it/);

  it('looks a passage up only in the cited file: identical files at two paths (identity fixture)', () => {
    const run = newRun();
    const notice = 'Welcome back. Please sign in.';
    const map = clone(run.map);
    map.names.push({ label: 'Welcome back', evidence: [{ file: 'src/copy-a/notice.txt', passage: notice }] });
    map.names.push({ label: 'Please sign in', evidence: [{ file: 'src/copy-b/notice.txt', passage: notice }] });
    run.writeMap(map);
    const same = run.run('check-map');
    expect(same.status, same.stdout).toBe(0);

    // A line that only one of the two copies has is found in that copy and in no other.
    writeFileSync(join(run.root, 'src/copy-b/notice.txt'), `${notice}\nOnly here.\n`);
    map.names[2] = { label: 'Only here', evidence: [{ file: 'src/copy-a/notice.txt', passage: 'Only here.' }] };
    run.writeMap(map);
    const wrongFile = run.run('check-map');
    expect(wrongFile.status).toBe(1);
    expect(wrongFile.stdout).toMatch(/names\[2\]\.evidence\[0\]: passage not in src\/copy-a\/notice\.txt/);
    map.names[2].evidence[0].file = 'src/copy-b/notice.txt';
    run.writeMap(map);
    expect(run.run('check-map').status).toBe(0);
  });

  it('rejects a path in .excavator, in node_modules and in the other excluded directories', () => {
    const run = newRun();
    for (const dir of ['.excavator', 'node_modules/pkg', 'vendor', 'dist', 'build', '.git']) {
      mkdirSync(join(run.root, dir), { recursive: true });
      writeFileSync(join(run.root, dir, 'note.txt'), 'Orders are listed here.\n');
    }
    for (const dir of ['.excavator', 'node_modules/pkg', 'vendor', 'dist', 'build', '.git']) {
      const map = clone(run.map);
      map.names.push({ label: 'Orders', evidence: [{ file: `${dir}/note.txt`, passage: 'Orders are listed here.' }] });
      run.writeMap(map);
      const bad = run.run('check-map');
      expect(bad.status, dir).toBe(1);
      const top = dir.split('/')[0];
      expect(bad.stdout, dir).toContain(`names[1].evidence[0]: ${dir}/note.txt is under ${top}, a directory that holds dependencies`);
    }
    run.writeMap();
    expect(run.run('check-map').status).toBe(0);
  });

  // The outside file is unreadable (unless the tests run as root), so a check that opened it would crash with exit 2 instead of exit 1.
  const unreadable = (path) => {
    writeFileSync(path, 'Orders are secret.\n');
    chmodSync(path, 0o000);
    return () => {
      chmodSync(path, 0o644);
      rmSync(path, { force: true });
    };
  };

  it('rejects a path with .. and does not read the file it points at', () => {
    const run = newRun();
    const restore = unreadable(join(run.base, 'outside.txt'));
    try {
      const map = clone(run.map);
      map.names.push({ label: 'Orders', evidence: [{ file: '../outside.txt', passage: 'Orders are secret.' }] });
      run.writeMap(map);
      const bad = run.run('check-map');
      expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
      expect(bad.stdout).toContain('names[1].evidence[0]: ../outside.txt leaves the project');
      run.writeMap();
      expect(run.run('check-map').status).toBe(0);
    } finally {
      restore();
    }
  });

  it('rejects a symlink that points outside the project and does not read its target', () => {
    const run = newRun();
    const restore = unreadable(join(run.base, 'secret.txt'));
    try {
      symlinkSync(join(run.base, 'secret.txt'), join(run.root, 'src/link.txt'));
      const map = clone(run.map);
      map.names.push({ label: 'Orders', evidence: [{ file: 'src/link.txt', passage: 'Orders are secret.' }] });
      run.writeMap(map);
      const bad = run.run('check-map');
      expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
      expect(bad.stdout).toContain('names[1].evidence[0]: src/link.txt resolves outside the project');
      // A symlink to a file inside the project is fine.
      rmSync(join(run.root, 'src/link.txt'));
      symlinkSync(join(run.root, 'src/menu.js'), join(run.root, 'src/link.txt'));
      map.names[1] = { label: 'WorkBoard', evidence: [{ file: 'src/link.txt', passage: "{ label: 'WorkBoard', path: '/board' }," }] };
      map.names.splice(0, 1);
      run.writeMap(map);
      const inside = run.run('check-map');
      expect(inside.status, `${inside.stdout}${inside.stderr}`).toBe(0);
    } finally {
      restore();
    }
  });

  it('rejects an absolute path', () => {
    const run = newRun();
    const map = clone(run.map);
    map.roles[0].evidence[0].file = join(run.root, 'src/roles.js');
    run.writeMap(map);
    const bad = run.run('check-map');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/roles\[0\]\.evidence\[0\]: .*is absolute/);
  });
});

describe('check-map: reader-visible names', () => {
  rejects('a feature name with an underscore identifier', (map) => {
    map.features[2].name = 'send_reminders';
  }, /features\[2\]\.name: "send_reminders" is not allowed in reader text \(underscore identifier\)/);

  rejects('an area name that is a path', (map) => {
    map.areas[0].name = 'Handled at /orders';
  }, /areas\[0\]\.name: "\/orders" is not allowed in reader text \(path\)/);

  rejects('an unassigned reason with code in it', (map) => {
    map.unassigned[0].reason = 'Handled by healthCheck';
  }, /unassigned\[0\]\.reason: "healthCheck" is not allowed in reader text \(camelCase identifier\)/);

  rejects('a number in a feature name that no passage states', (map) => {
    map.features[0].name = 'Orders 2';
  }, /features\[0\]\.name: number 2 does not occur in this item's passages/);

  it('lets a role or a name keep a camel-case label that its evidence verifies', () => {
    const run = newRun();
    expect(run.map.names[0].label).toBe('WorkBoard');
    run.writeMap();
    expect(run.run('check-map').status).toBe(0);
  });
});

describe('check-map: candidates.json and state.json', () => {
  it('refuses a candidates.json that names another project root', () => {
    const run = newRun();
    run.writeMap();
    const candidates = clone(run.candidates);
    candidates.projectRoot = join(run.base, 'elsewhere');
    mkdirSync(candidates.projectRoot);
    run.writeJson(join(run.out, 'candidates.json'), candidates);
    const bad = run.run('check-map');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain(`candidates.json: projectRoot ${candidates.projectRoot} is not the project given with --project (${run.root})`);
    run.writeJson(join(run.out, 'candidates.json'), run.candidates);
    expect(run.run('check-map').status).toBe(0);
  });

  it('compares the project roots by real path: a symlink to the same project passes', () => {
    const run = newRun();
    run.writeMap();
    const alias = join(run.base, 'alias');
    symlinkSync(run.root, alias);
    const candidates = clone(run.candidates);
    candidates.projectRoot = alias;
    run.writeJson(join(run.out, 'candidates.json'), candidates);
    expect(run.run('check-map').status).toBe(0);
  });

  it('keeps an existing state.json for the same features', () => {
    const run = newRun();
    run.writeMap();
    expect(run.run('check-map').status).toBe(0);
    expect(run.run('mark', 'F1', 'dispatched').status).toBe(0);
    expect(run.run('check-map').status).toBe(0);
    expect(run.readJson('state.json').features.F1).toEqual({ status: 'dispatched', attempts: 1 });
  });

  it('refuses a state.json whose features differ from the map and asks for --fresh', () => {
    const run = newRun();
    run.writeMap();
    expect(run.run('check-map').status).toBe(0);
    const map = clone(run.map);
    set(map, 'features.4.id', 'F6');
    run.writeMap(map);
    const bad = run.run('check-map');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/state\.json lists the features F1, F2, F3, F4, F5 but map\.json has F1, F2, F3, F4, F6; run again with --fresh/);
    rmSync(join(run.out, 'state.json'));
    expect(run.run('check-map').status).toBe(0);
  });

  it('refuses a map with fewer features than state.json lists, too', () => {
    const run = newRun();
    run.writeMap();
    expect(run.run('check-map').status).toBe(0);
    const map = clone(run.map);
    map.unassigned.push({ candidate: map.features[4].candidates[0], reason: 'Left out on purpose.' });
    map.features.splice(4, 1);
    run.writeMap(map);
    const bad = run.run('check-map');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/state\.json lists the features F1, F2, F3, F4, F5 but map\.json has F1, F2, F3, F4; run again with --fresh/);
  });

  it('refuses a map with more features than state.json lists', () => {
    const run = newRun();
    const small = clone(run.map);
    small.unassigned.push({ candidate: small.features[4].candidates[0], reason: 'Left out on purpose.' });
    small.features.splice(4, 1);
    run.writeMap(small);
    expect(run.run('check-map').status).toBe(0);
    run.writeMap();
    const bad = run.run('check-map');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/state\.json lists the features F1, F2, F3, F4 but map\.json has F1, F2, F3, F4, F5; run again with --fresh/);
  });
});

describe('handbook.mjs usage', () => {
  it('exits 2 for an unknown command, a missing --project and a missing out directory', () => {
    expect(runHandbook(['frobnicate']).status).toBe(2);
    expect(runHandbook([]).status).toBe(2);
    const run = newRun();
    expect(runHandbook(['check-map', run.out]).status).toBe(2);
    expect(runHandbook(['check-map', join(run.base, 'missing'), '--project', run.root]).status).toBe(2);
    expect(runHandbook(['check-map', run.out, '--project', join(run.base, 'missing')]).status).toBe(2);
  });

  it('exits 2 when map.json is missing and 1 when it is not JSON', () => {
    const run = newRun();
    expect(run.run('check-map').status).toBe(2);
    writeFileSync(join(run.out, 'map.json'), '{ not json');
    const bad = run.run('check-map');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/map\.json is not valid JSON/);
  });
});
