/**
 * The application roots of a project (openspec change handbook-system-overview):
 * the topmost directories that hold a build manifest. The walk and its skip
 * rules are the candidate lister's (entrypoints.mjs `walk`): the same skipped
 * directories, no link followed. The system overview names one directory per
 * application; check-overview holds that list to these roots, and the system
 * facts (system-facts.mjs) count the files under each. A directory is a
 * project-relative POSIX path; the project root itself is ".".
 */

import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';

import { MAX_FILE_BYTES, TEST_FILE, walk } from './entrypoints.mjs';
import { languageOf } from './source-languages.mjs';

/** Build manifests by exact file name; a `*.csproj` or `*.sln` file counts too. */
export const MANIFEST_NAMES = Object.freeze([
  'package.json', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pyproject.toml',
  'setup.py', 'requirements.txt', 'Cargo.toml', 'composer.json', 'Gemfile',
]);
const MANIFEST_SUFFIXES = Object.freeze(['.csproj', '.sln']);

export const isManifestName = (name) => MANIFEST_NAMES.includes(name) || MANIFEST_SUFFIXES.some((suffix) => name.endsWith(suffix) && name.length > suffix.length);

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dirOf = (rel) => (rel.includes('/') ? dirname(rel) : '.');

/** Whether `dir` is `ancestor` or lies below it. */
export const isUnder = (dir, ancestor) => ancestor === '.' || dir === ancestor || dir.startsWith(`${ancestor}/`);

/**
 * Walk `projectRoot` once. Returns `{ root, manifests, roots, sourceFiles }`:
 * `manifests` maps each directory that holds a build manifest to the sorted
 * names of its manifests; `roots` are the topmost of those directories, sorted;
 * `sourceFiles` are `{ rel, abs, language }` for each file in a source
 * language (source-languages.mjs) that the candidate lister would not skip
 * for its name or size (a test file, a file over its size cap). A file with a
 * NUL byte is skipped when it is read (system-facts.mjs).
 */
export function scanProject(projectRootArg) {
  const root = realpathSync(projectRootArg);
  const stats = { seen: 0, skipped: { symlink: 0, unreadable: 0 }, skippedDirectories: {} };
  const manifests = new Map();
  const sourceFiles = [];
  walk(root, null, stats, (rel, abs, size) => {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (isManifestName(name)) {
      const dir = dirOf(rel);
      manifests.set(dir, [...(manifests.get(dir) ?? []), name].sort(compare));
    }
    const language = languageOf(rel);
    if (language !== null && !TEST_FILE.test(name) && size <= MAX_FILE_BYTES) sourceFiles.push({ rel, abs, language });
  });
  const dirs = [...manifests.keys()].sort(compare);
  const roots = dirs.filter((dir) => !dirs.some((other) => other !== dir && isUnder(dir, other)));
  return { root, manifests, roots, sourceFiles };
}

/** The lines `handbook.mjs applications` prints: a count line, then `<dir>\t<manifests>` for each root. */
export function applicationLines(scan) {
  return [`Application roots: ${scan.roots.length}`, ...scan.roots.map((dir) => `${dir}\t${scan.manifests.get(dir).join(', ')}`)];
}
