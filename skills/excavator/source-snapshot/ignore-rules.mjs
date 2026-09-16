/**
 * ignore-rules.mjs
 *
 * Builds the shared source-selection policy (+ the ordered descriptors
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
const {
  LanguageRegistry,
  PRIVATE_KEY_PREFIX_BYTES,
  buildSourceSelectionLedger,
  createSourceSelectionPolicy,
  resolveDataDir,
} = core;

export const selectionPrefixBytes = PRIVATE_KEY_PREFIX_BYTES;

const LANGUAGE_MATCHING_DESCRIPTORS = Object.freeze([
  'language-match-precedence:exact-filename>basename-pattern>extension',
  ...LanguageRegistry.createDefault()
    .getAllLanguages()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((config) => [
      `language:${config.id}`,
      `filenames:${(config.filenames ?? []).join(',')}`,
      `basename-patterns:${(config.basenamePatterns ?? []).join(',')}`,
      `extensions:${config.extensions.join(',')}`,
    ].join('|')),
]);

function patternsFromContent(content) {
  if (!content) return [];
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function buildRules(projectPatterns, cliPatterns, rawRuleDescriptors = []) {
  const policy = createSourceSelectionPolicy({ projectPatterns, cliPatterns });
  const descriptors = [
    ...policy.descriptors,
    ...rawRuleDescriptors,
    ...LANGUAGE_MATCHING_DESCRIPTORS,
  ];
  return {
    policy,
    descriptors,
    digest: hashSelectionDigest(descriptors),
    // Compatibility for existing ignore-rules unit consumers. Snapshot
    // adapters use `policy` directly so header-based sensitivity is visible.
    filter: { isIgnored: (path) => policy.decide({ path }).kind !== 'selected' },
  };
}

export function selectionLedger(decisions) {
  return buildSourceSelectionLedger(decisions);
}

/**
 * @param {string|null|undefined} excavatorignoreContent raw `.excavatorignore`
 *   content already read from wherever it lives (e.g. `git show HEAD:...`),
 *   or null/undefined if none exists there.
 * @param {string[]} [extraExcludePatterns]
 * @returns {{ filter: { isIgnored(path: string): boolean }, descriptors: string[], digest: string }}
 */
export function ignoreRulesFromContent(excavatorignoreContent, extraExcludePatterns = []) {
  const rawDescriptors = excavatorignoreContent === null || excavatorignoreContent === undefined
    ? []
    : [`root-ignorefile:${excavatorignoreContent}`];
  return buildRules(
    patternsFromContent(excavatorignoreContent),
    extraExcludePatterns,
    rawDescriptors,
  );
}

/**
 * @param {string} root a real directory on disk
 * @param {string[]} [extraExcludePatterns]
 * @returns {{ filter: { isIgnored(path: string): boolean }, descriptors: string[], digest: string }}
 */
export function ignoreRulesFromDisk(root, extraExcludePatterns = []) {
  // Preserve the current load order for this group: data-dir file, root file,
  // then CLI patterns. Group 5 removes the data-dir source.
  const projectPatterns = [];
  const rawDescriptors = [];
  const dataIgnorePath = join(resolveDataDir(root), '.excavatorignore');
  if (existsSync(dataIgnorePath)) {
    const content = readFileSync(dataIgnorePath, 'utf-8');
    projectPatterns.push(...patternsFromContent(content));
    rawDescriptors.push(`data-ignorefile:${content}`);
  }
  const rootIgnorePath = join(root, '.excavatorignore');
  if (existsSync(rootIgnorePath)) {
    const content = readFileSync(rootIgnorePath, 'utf-8');
    projectPatterns.push(...patternsFromContent(content));
    rawDescriptors.push(`root-ignorefile:${content}`);
  }
  return buildRules(projectPatterns, extraExcludePatterns, rawDescriptors);
}
