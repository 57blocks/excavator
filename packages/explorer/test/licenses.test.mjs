import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { NOTICE_HEADING, checkLicenseNotice, licenseNotice, packageOfModule, readBundledPackage } from '../scripts/licenses.mjs';
import { CSP_MARKER, DATA_MARKER, collapseBundle } from '../scripts/single-file.mjs';

const NUL = String.fromCharCode(0);

describe('packageOfModule', () => {
  it('names the package of a module in a pnpm store and the directory that holds its package.json', () => {
    expect(packageOfModule('/r/node_modules/.pnpm/elkjs@0.12.0/node_modules/elkjs/lib/elk.bundled.js')).toEqual({
      name: 'elkjs',
      root: '/r/node_modules/.pnpm/elkjs@0.12.0/node_modules/elkjs',
    });
  });

  it('keeps the scope of a scoped package, and reads past a query and the NUL that marks a generated module', () => {
    expect(packageOfModule('/r/node_modules/@xyflow/react/dist/esm/index.js')?.name).toBe('@xyflow/react');
    expect(packageOfModule(`${NUL}/r/node_modules/react/index.js?commonjs-module`)).toEqual({ name: 'react', root: '/r/node_modules/react' });
    expect(packageOfModule('C:\\r\\node_modules\\d3-force\\src\\index.js')?.name).toBe('d3-force');
  });

  it('takes the innermost node_modules, and gives nothing for a module of the project or a path that leaves the package', () => {
    expect(packageOfModule('/r/node_modules/a/node_modules/b/x.js')?.name).toBe('b');
    expect(packageOfModule('/r/packages/explorer/src/main.tsx')).toBeNull();
    expect(packageOfModule('/r/node_modules/a')).toBeNull();
    expect(packageOfModule('/r/node_modules/../x.js')).toBeNull();
  });
});

describe('readBundledPackage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xv-licenses-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, manifest) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'package.json'), JSON.stringify(manifest));
    return join(dir, name);
  };

  it('reads the name, the version and the licence id of the package itself', () => {
    expect(readBundledPackage(write('a', { name: 'a', version: '1.2.3', license: 'MIT' }))).toEqual({ name: 'a', version: '1.2.3', license: 'MIT' });
  });

  it('accepts the older licence fields, and says so when there is none', () => {
    expect(readBundledPackage(write('b', { name: 'b', version: '1.0.0', license: { type: 'BSD-3-Clause' } })).license).toBe('BSD-3-Clause');
    expect(readBundledPackage(write('c', { name: 'c', version: '1.0.0', licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).license).toBe('MIT OR Apache-2.0');
    expect(readBundledPackage(write('d', { name: 'd', version: '1.0.0' })).license).toBe('no licence field');
  });
});

describe('licenseNotice', () => {
  const pkg = (name, version, license = 'MIT') => ({ name, version, license });

  it('is one comment with the heading and a line for each package, by name then version, once each', () => {
    const notice = licenseNotice([pkg('react', '19.2.8'), pkg('elkjs', '0.12.0', 'EPL-2.0 OR GPL-3.0-or-later'), pkg('react', '19.2.8'), pkg('react', '18.0.0')]);
    expect(notice).toBe(`<!--\n${NOTICE_HEADING}\nelkjs 0.12.0 EPL-2.0 OR GPL-3.0-or-later\nreact 18.0.0 MIT\nreact 19.2.8 MIT\n-->\n`);
  });

  it('is the same for the same packages in any order', () => {
    const a = [pkg('a', '1.0.0'), pkg('b', '1.0.0'), pkg('c', '1.0.0')];
    expect(licenseNotice([...a].reverse())).toBe(licenseNotice(a));
  });

  it('cannot end its comment early, whatever a package.json says', () => {
    const notice = licenseNotice([pkg('x', '1.0.0', 'MIT --> <script>alert(1)</script>')]);
    const body = notice.slice('<!--'.length, -'-->\n'.length);
    expect(body).not.toContain('--');
    expect(notice.indexOf('-->')).toBe(notice.length - '-->\n'.length);
  });
});

describe('checkLicenseNotice', () => {
  const good = `${licenseNotice([{ name: 'elkjs', version: '0.12.0', license: 'EPL-2.0' }, { name: 'react', version: '19.2.8', license: 'MIT' }])}<!doctype html>`;

  it('accepts a file that starts with the notice and lists the packages asked for', () => {
    expect(checkLicenseNotice(good, ['elkjs', 'react'])).toBeNull();
  });

  it('names what is wrong: no comment, another comment, no package, a package that is missing', () => {
    expect(checkLicenseNotice('<!doctype html>')).toMatch(/does not start with the licence notice/);
    expect(checkLicenseNotice('<!--\nsomething else\n-->\n<!doctype html>')).toMatch(/not the licence notice/);
    expect(checkLicenseNotice(`<!--\n${NOTICE_HEADING}\n-->\n`)).toMatch(/does not start|lists no package/);
    expect(checkLicenseNotice(good, ['d3-force'])).toBe('the licence notice does not list d3-force');
    expect(checkLicenseNotice(good.replace('elkjs 0.12.0', 'xelkjs 0.12.0'), ['elkjs'])).toBe('the licence notice does not list elkjs');
  });
});

describe('the notice in the bundle', () => {
  const bundle = () => ({
    'explorer.html': { type: 'asset', fileName: 'explorer.html', source: `<!doctype html><html><head>${CSP_MARKER}</head><body>${DATA_MARKER}<script type="module" src="./a.js"></script></body></html>` },
    'a.js': { type: 'chunk', fileName: 'a.js', code: 'console.log(1);' },
  });

  it('puts the notice before everything else in explorer.html and keeps the contract', () => {
    const files = bundle();
    const notice = licenseNotice([{ name: 'elkjs', version: '0.12.0', license: 'EPL-2.0' }]);
    collapseBundle(files, notice);
    expect(files['explorer.html'].source.startsWith(`${notice}<!doctype html>`)).toBe(true);
    expect(checkLicenseNotice(files['explorer.html'].source, ['elkjs'])).toBeNull();
  });

  it('adds nothing when no notice is given', () => {
    const files = bundle();
    collapseBundle(files);
    expect(files['explorer.html'].source.startsWith('<!doctype html>')).toBe(true);
  });
});
