/**
 * The application roots of a project (openspec change handbook-system-overview):
 * the topmost directories that hold a build manifest. The walk and its skip
 * rules are the candidate lister's (entrypoints.mjs `walk`): the same skipped
 * directories, no link followed. The system overview names one directory per
 * application; check-overview holds that list to these roots, and the system
 * facts (system-facts.mjs) count the files under each. A directory that declares a
 * JavaScript workspace (a `pnpm-workspace.yaml`, or a `package.json` with `workspaces`)
 * is no application when manifest directories lie below it: its topmost ones are
 * (openspec change handbook-run-precision D2). A directory is a
 * project-relative POSIX path; the project root itself is ".".
 */

import { readFileSync, realpathSync } from 'node:fs';
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

/** Whether a `package.json` text declares workspaces: an array, or an object with a `packages` array. */
export function declaresWorkspaces(text) {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return false;
  }
  const workspaces = pkg !== null && typeof pkg === 'object' ? pkg.workspaces : undefined;
  return Array.isArray(workspaces) || (workspaces !== null && typeof workspaces === 'object' && Array.isArray(workspaces.packages));
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dirOf = (rel) => (rel.includes('/') ? dirname(rel) : '.');

/** Whether `dir` is `ancestor` or lies below it. */
export const isUnder = (dir, ancestor) => ancestor === '.' || dir === ancestor || dir.startsWith(`${ancestor}/`);

/**
 * Walk `projectRoot` once. Returns `{ root, manifests, roots, sourceFiles }`:
 * `manifests` maps each directory that holds a build manifest to the sorted
 * names of its manifests; `roots` are the topmost of those directories (a JavaScript workspace root replaced by its members), sorted;
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
  const workspaceDirs = new Set();
  walk(root, null, stats, (rel, abs, size) => {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (name === 'pnpm-workspace.yaml') workspaceDirs.add(dirOf(rel));
    if (name === 'package.json' && size <= MAX_FILE_BYTES) {
      try {
        if (declaresWorkspaces(readFileSync(abs, 'utf-8'))) workspaceDirs.add(dirOf(rel));
      } catch {
        // An unreadable package.json is still a manifest; it declares no workspace.
      }
    }
    if (isManifestName(name)) {
      const dir = dirOf(rel);
      manifests.set(dir, [...(manifests.get(dir) ?? []), name].sort(compare));
    }
    const language = languageOf(rel);
    if (language !== null && !TEST_FILE.test(name) && size <= MAX_FILE_BYTES) sourceFiles.push({ rel, abs, language });
  });
  const all = [...manifests.keys()].sort(compare);
  // A workspace root with manifest directories below it is not an application; its members are found as the topmost of what remains.
  const dirs = all.filter((dir) => !(workspaceDirs.has(dir) && all.some((other) => other !== dir && isUnder(other, dir))));
  const roots = dirs.filter((dir) => !dirs.some((other) => other !== dir && isUnder(dir, other)));
  return { root, manifests, roots, sourceFiles };
}

/** The lines `handbook.mjs applications` prints: a count line, then `<dir>\t<manifests>` for each root. */
export function applicationLines(scan) {
  return [`Application roots: ${scan.roots.length}`, ...scan.roots.map((dir) => `${dir}\t${scan.manifests.get(dir).join(', ')}`)];
}
