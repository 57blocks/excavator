/**
 * The system name candidates of a project (openspec change
 * handbook-system-name): the names the code and the configuration write, each
 * `{ value, source, file, line, resolved }`. They are looked for only in each
 * application root of the project (applications.mjs) and in its `public/`
 * directory, directly and not below; no file is walked for, no documentation
 * file is read, and a link is not followed. The overview picks one candidate
 * (overview-name.mjs checks that it is one); the model reads none of the files
 * for it.
 *
 * Sources, in the order that breaks a tie on one line: the `name` and
 * `short_name` of `manifest.json` and `*.webmanifest`; the `<title>` of each
 * `*.html`; the `productName`, `displayName` and `name` of `package.json`; the
 * last segment of the `module` of `go.mod`; the `<name>` and `<artifactId>` of
 * the root of `pom.xml`; the `rootProject.name` of `settings.gradle(.kts)`.
 *
 * A title that refers to a variable (`%NAME%`, `${NAME}`, `import.meta.env.NAME`)
 * is listed as written and, for each variable, the value of its first
 * definition in `.env`, `.env.production`, `.env.development` of the same root
 * is listed as a candidate of its own, at its line in that file. A value that
 * still refers to a variable or a property is `resolved: false`: it is not a
 * name. An empty value is no candidate. A file that exists and cannot be read
 * as it is (a link, over the size cap, a NUL byte, JSON that does not parse)
 * is returned in `unread` with the reason, never dropped.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAX_FILE_BYTES } from './entrypoints.mjs';
import { envValue, goModule, gradleRootNames, hasReference, htmlTitle, jsonTopLevelStrings, mavenNames, parseJsonObject, variableReferences } from './name-parsers.mjs';

/** The sources, in tie-break order. */
export const SOURCES = Object.freeze([
  'web-manifest-name', 'web-manifest-short-name', 'html-title', 'package-product-name', 'package-display-name', 'package-name',
  'go-module', 'maven-name', 'maven-artifact', 'gradle-root',
]);

const ENV_FILES = Object.freeze(['.env', '.env.production', '.env.development']);
const PACKAGE_KEYS = Object.freeze({ productName: 'package-product-name', displayName: 'package-display-name', name: 'package-name' });
const MANIFEST_KEYS = Object.freeze({ name: 'web-manifest-name', short_name: 'web-manifest-short-name' });
const MAVEN_SOURCES = Object.freeze({ name: 'maven-name', artifactId: 'maven-artifact' });

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const joinRel = (dir, name) => (dir === '.' ? name : `${dir}/${name}`);

/** The names of the regular files and links directly in directory `dir` (project-relative), sorted; empty when it is not a directory of its own. */
function entriesOf(root, dir) {
  const abs = dir === '.' ? root : join(root, dir);
  try {
    if (!lstatSync(abs).isDirectory()) return [];
    return readdirSync(abs).sort(compare);
  } catch {
    return [];
  }
}

/**
 * Read `rel` as text for the candidate lister: `{ text }`, or `{ reason }` for a
 * file it must not read, or null when there is no regular file or link of that name.
 */
function readText(root, rel) {
  const abs = join(root, rel);
  let info;
  try {
    info = lstatSync(abs);
  } catch {
    return null;
  }
  if (info.isSymbolicLink()) return { reason: 'is a link, not followed' };
  if (!info.isFile()) return null;
  if (info.size > MAX_FILE_BYTES) return { reason: `larger than ${MAX_FILE_BYTES} bytes` };
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch {
    return { reason: 'cannot be read' };
  }
  if (bytes.includes(0)) return { reason: 'holds a NUL byte' };
  return { text: bytes.toString('utf-8') };
}

/** The candidates and the unread files of one application root. */
function candidatesOfRoot(scanRoot, dir, unread) {
  const found = [];
  const add = (value, source, file, line) => {
    if (value === '') return;
    found.push({ value, source, file, line, resolved: !hasReference(value) });
  };
  const read = (file) => {
    const result = readText(scanRoot, file);
    if (result?.reason !== undefined) unread.push({ file, reason: result.reason });
    return result?.text ?? null;
  };
  const jsonValues = (file, keys) => {
    const text = read(file);
    if (text === null) return;
    if (parseJsonObject(text) === null) {
      unread.push({ file, reason: 'not valid JSON' });
      return;
    }
    for (const item of jsonTopLevelStrings(text, Object.keys(keys))) add(item.value, keys[item.key], file, item.line);
  };

  const envTexts = new Map();
  const envText = (name) => {
    if (!envTexts.has(name)) envTexts.set(name, read(joinRel(dir, name)));
    return envTexts.get(name);
  };
  const htmlFile = (file) => {
    const text = read(file);
    if (text === null) return;
    const title = htmlTitle(text);
    if (title === null || title.value === '') return;
    add(title.value, 'html-title', file, title.line);
    for (const name of variableReferences(title.value)) {
      for (const envName of ENV_FILES) {
        const text = envText(envName);
        const defined = text === null ? null : envValue(text, name);
        if (defined !== null && defined.value !== '') {
          add(defined.value, 'html-title', joinRel(dir, envName), defined.line);
          break;
        }
      }
    }
  };

  const publicDir = joinRel(dir, 'public');
  try {
    if (lstatSync(join(scanRoot, publicDir)).isSymbolicLink()) unread.push({ file: publicDir, reason: 'is a link, not followed' });
  } catch {
    // No public directory: nothing to read there.
  }
  for (const place of [dir, publicDir]) {
    for (const name of entriesOf(scanRoot, place)) {
      const file = joinRel(place, name);
      if (name === 'manifest.json' || name.endsWith('.webmanifest')) jsonValues(file, MANIFEST_KEYS);
      else if (name.endsWith('.html')) htmlFile(file);
    }
  }
  const own = new Set(entriesOf(scanRoot, dir));
  if (own.has('package.json')) jsonValues(joinRel(dir, 'package.json'), PACKAGE_KEYS);
  if (own.has('go.mod')) {
    const text = read(joinRel(dir, 'go.mod'));
    const module = text === null ? null : goModule(text);
    if (module !== null) add(module.value, 'go-module', joinRel(dir, 'go.mod'), module.line);
  }
  if (own.has('pom.xml')) {
    const text = read(joinRel(dir, 'pom.xml'));
    if (text !== null) for (const item of mavenNames(text)) add(item.value, MAVEN_SOURCES[item.tag], joinRel(dir, 'pom.xml'), item.line);
  }
  for (const name of ['settings.gradle', 'settings.gradle.kts']) {
    if (!own.has(name)) continue;
    const text = read(joinRel(dir, name));
    if (text !== null) for (const item of gradleRootNames(text)) add(item.value, 'gradle-root', joinRel(dir, name), item.line);
  }
  return found;
}

/** Sort by file, line and source order, then keep the first of each value at one place. */
function arranged(candidates) {
  const sorted = [...candidates].sort((a, b) => compare(a.file, b.file) || a.line - b.line || SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source));
  const seen = new Set();
  return sorted.filter((item) => {
    const key = `${item.file}\0${item.line}\0${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * `{ candidates, unread }` of a project scan (applications.mjs `scanProject`):
 * the candidates of each application root in root order, each root's in file,
 * line and source order; and the files that exist but were not read, with the reason.
 */
export function nameCandidates(scan) {
  const unread = [];
  const candidates = scan.roots.flatMap((dir) => arranged(candidatesOfRoot(scan.root, dir, unread)));
  return { candidates, unread: unread.sort((a, b) => compare(a.file, b.file)) };
}

/** The lines `handbook.mjs names` prints: a count line and a row `<value>\t<source>\t<file>:<line>\t<resolved|unresolved>` for each candidate, then a count line and a row `<file>\t<reason>` for each file not read. */
export function nameLines({ candidates, unread }) {
  return [
    `Name candidates: ${candidates.length}`,
    ...candidates.map((item) => [item.value, item.source, `${item.file}:${item.line}`, item.resolved ? 'resolved' : 'unresolved'].join('\t')),
    `Files not read: ${unread.length}`,
    ...unread.map((item) => `${item.file}\t${item.reason}`),
  ];
}
