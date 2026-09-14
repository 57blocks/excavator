/**
 * ignore-rules.mjs
 *
 * Builds the effective ignore/exclude filter (+ the ordered rule descriptors
 * `selectionDigest` hashes) for a SourceSnapshot. Two flavors:
 *
 *   - `ignoreRulesFromDisk(root, extra)`      — reads `.excavatorignore` live
 *     off disk (DirectorySnapshot, and MultiRepoSnapshot's parent source).
 *   - `ignoreRulesFromContent(content, extra)` — the `.excavatorignore`
 *     content is already known as an in-memory string (or absent), read from
 *     HEAD rather than disk (GitCommitSnapshot). Reuses core's
 *     `createIgnoreFilter` by pointing it at a directory guaranteed to have
 *     no `.excavatorignore` of its own and folding the HEAD content in as
 *     synthetic extra patterns — `createIgnoreFilter` only ever *appends*
 *     patterns to one matcher, so which tier added a pattern doesn't affect
 *     matching, only which files it reads them from.
 *
 * Both flavors return a filter whose `.excavator/` exclusion cannot be
 * overridden by any user pattern (spec: "`.excavator/` SHALL is always excluded") —
 * enforced structurally here, outside the `ignore`-package matcher, so a
 * `.excavatorignore` negation (`!.excavator/`) can never re-include it
 * regardless of pattern-ordering semantics.
 */

import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { selectionDigest as hashSelectionDigest } from './manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/excavator/source-snapshot/ -> plugin root is three dirs up.
const pluginRoot = resolve(__dirname, '../../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}
const { createIgnoreFilter, DEFAULT_IGNORE_PATTERNS, resolveDataDir } = core;

/** Always-true regardless of any `ignore`-package negation — the structural
 *  guarantee behind "`.excavator/` SHALL is always excluded". */
function isAlwaysExcavatorDir(path) {
  return path === '.excavator' || path.startsWith('.excavator/');
}

function wrapFilter(filter) {
  return {
    isIgnored(path) {
      return isAlwaysExcavatorDir(path) || filter.isIgnored(path);
    },
  };
}

/** A directory path guaranteed to have no `.excavatorignore` of its own —
 *  used so `ignoreRulesFromContent` builds its matcher purely from the
 *  synthetic patterns it is given. Mirrors scan-project.mjs's own
 *  `buildDefaultsOnlyFilter` trick. */
function fakeIgnoreRoot() {
  return join(tmpdir(), `excavator-snapshot-ignore-fake-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

const BASE_DESCRIPTORS = Object.freeze([
  'defaults:v1',
  ...DEFAULT_IGNORE_PATTERNS.map((p) => `default:${p}`),
  'always-exclude:.excavator/',
]);

/**
 * @param {string|null|undefined} excavatorignoreContent raw `.excavatorignore`
 *   content already read from wherever it lives (e.g. `git show HEAD:...`),
 *   or null/undefined if none exists there.
 * @param {string[]} [extraExcludePatterns]
 * @returns {{ filter: { isIgnored(path: string): boolean }, descriptors: string[], digest: string }}
 */
export function ignoreRulesFromContent(excavatorignoreContent, extraExcludePatterns = []) {
  const descriptors = [...BASE_DESCRIPTORS];
  const patterns = [];
  if (excavatorignoreContent) {
    const lines = excavatorignoreContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    patterns.push(...lines);
    descriptors.push(`root-ignorefile:${excavatorignoreContent}`);
  }
  for (const p of extraExcludePatterns) {
    patterns.push(p);
    descriptors.push(`extra:${p}`);
  }
  const filter = wrapFilter(createIgnoreFilter(fakeIgnoreRoot(), patterns));
  return { filter, descriptors, digest: hashSelectionDigest(descriptors) };
}

/**
 * @param {string} root a real directory on disk
 * @param {string[]} [extraExcludePatterns]
 * @returns {{ filter: { isIgnored(path: string): boolean }, descriptors: string[], digest: string }}
 */
export function ignoreRulesFromDisk(root, extraExcludePatterns = []) {
  const descriptors = [...BASE_DESCRIPTORS];
  // Mirror createIgnoreFilter's own read order (data-dir file, then root
  // file) so the digest reflects exactly what it applied.
  const dataIgnorePath = join(resolveDataDir(root), '.excavatorignore');
  if (existsSync(dataIgnorePath)) descriptors.push(`data-ignorefile:${readFileSync(dataIgnorePath, 'utf-8')}`);
  const rootIgnorePath = join(root, '.excavatorignore');
  if (existsSync(rootIgnorePath)) descriptors.push(`root-ignorefile:${readFileSync(rootIgnorePath, 'utf-8')}`);
  for (const p of extraExcludePatterns) descriptors.push(`extra:${p}`);

  const filter = wrapFilter(createIgnoreFilter(root, extraExcludePatterns));
  return { filter, descriptors, digest: hashSelectionDigest(descriptors) };
}
