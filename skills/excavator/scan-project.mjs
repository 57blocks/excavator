#!/usr/bin/env node
/**
 * scan-project.mjs
 *
 * Deterministic file enumeration + language/category detection for the
 * project-scanner agent. Replaces the LLM-written prose scanner that used to
 * (a) author a per-run Node.js script (`tmp/ua-project-scan.js`), (b) walk the
 * file tree, and (c) classify each file via lookup tables in LLM context — a
 * pure rule-lookup pass that was being billed at LLM rates and adding many
 * minutes of per-run latency on mid-sized monorepos.
 *
 * What the LLM still owns (Step A of project-scanner.md Phase 1):
 *   - Reading README + top-level manifests to synthesize `name`,
 *     `rawDescription`, `readmeHead`, `frameworks`, and the high-level
 *     `languages` narrative.
 *
 * What this script owns:
 *   - File enumeration (git ls-files preferred, recursive walk fallback)
 *   - Versioned pre-extraction selection, including sensitive-file containment
 *   - Per-file language detection (extension + filename table)
 *   - Per-file category assignment (priority-ordered rules from
 *     project-scanner.md Step 4)
 *   - Line counting
 *   - Complexity estimation (project-scanner.md Step 7 thresholds)
 *
 * Usage:
 *   node scan-project.mjs <projectRoot> <outputPath>
 *     [--exclude <patterns>] [--exclude-analysis-data]
 *
 *   --exclude <patterns>  Comma-separated gitignore-style patterns to
 *                         additionally exclude from the scan.
 *   --exclude-analysis-data  Always exclude the persistent `.excavator/`
 *                            analysis data directory.
 *
 * Output JSON (subset of what project-scanner.md Phase 1 expects — the LLM
 * agent merges this with Step A's narrative fields and Step C's importMap to
 * produce the final scan-result.json):
 *   {
 *     "scriptCompleted": true,
 *     "contentDigest": "<sha256 lowercase hex>",
 *     "files": [{ "path": "...", "language": "...", "sizeLines": N, "fileCategory": "..." }, ...],
 *     "totalFiles": N,
 *     "filteredByIgnore": M,
 *     "filteredByDefaults": K,
 *     "selection": { "policyVersion": "...", "candidates": N, "selected": N, "entries": [...] },
 *     "skipped": [{ "path": "...", "reason": "filtered-by-defaults|filtered-by-ignore|sensitive|symlink|read-failed|unknown-language|binary|too-large", "language": "..." }, ...],
 *     "coverage": { "limits": { "maxFileLines": N, "maxFileBytes": N } },
 *     "estimatedComplexity": "small" | "moderate" | "large" | "very-large",
 *     "stats": { "filesScanned": N, "byCategory": {...}, "byLanguage": {...} }
 *   }
 *
 * Logging: stderr only (stdout reserved for piped tooling).
 * Per-file resilience: read/stat failures emit
 *   `Warning: scan-project: <path> — <reason> — file skipped from output`
 * to stderr and the file is dropped; the rest of the scan completes.
 *
 * Determinism: files are sorted by a locale-independent UTF-16 code-unit
 * comparison before emission. The content digest uses that same order and
 * length-frames each UTF-8 relative path plus its raw file bytes.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, basename, extname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  existsSync,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/excavator/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @excavator/core
//
// Two-step resolution: try the workspace-linked package first, fall back to
// the installed plugin cache layout. pathToFileURL() is required on Windows
// because dynamic import() of raw "C:\..." paths throws
// ERR_UNSUPPORTED_ESM_URL_SCHEME (Node parses "C:" as a URL scheme).
// ---------------------------------------------------------------------------
let core;
try {
  core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const {
  PRIVATE_KEY_PREFIX_BYTES,
  LanguageRegistry,
  buildSourceSelectionLedger,
  createSourceSelectionPolicy,
  resolveDataDir,
} = core;

const canonicalLanguageRegistry = LanguageRegistry.createDefault();

// ---------------------------------------------------------------------------
// Skip limits and binary detection
//
// A scanned file that is never handed to extraction must land in a NAMED skip
// bucket, so the coverage ledger can account for every input. These two
// thresholds are published in the scan output under `coverage.limits`, because
// a `too-large` count is meaningless without the limit that produced it.
// ---------------------------------------------------------------------------

/** Files with more newlines than this are skipped (reason: too-large). */
export const MAX_FILE_LINES = 20000;
/** Files with more bytes than this are skipped (reason: too-large). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** How many leading bytes are inspected for a NUL byte (binary sniff). */
export const BINARY_SNIFF_BYTES = 8192;

/**
 * Extensions that are binary by definition. Checked BEFORE the file is read so
 * a 200MB `.dll` never enters memory; files not in this table are still
 * sniffed for a NUL byte in their first BINARY_SNIFF_BYTES bytes.
 */
export const BINARY_EXTENSIONS = Object.freeze(new Set([
  // native / managed binaries and intermediates
  '.dll', '.exe', '.so', '.dylib', '.a', '.lib', '.o', '.obj', '.pdb', '.ilk',
  '.class', '.jar', '.war', '.ear', '.nupkg', '.snupkg', '.wasm', '.pyc', '.pyo',
  '.node', '.bin', '.msi', '.apk', '.aab', '.ipa', '.framework',
  // archives
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.jar', '.iso', '.dmg',
  // images / media / fonts
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.icns', '.tif', '.tiff', '.webp',
  '.psd', '.ai', '.eps', '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.m4a', '.m4v',
  '.avi', '.mov', '.wmv', '.webm', '.mkv', '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // documents / data stores
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.db', '.sqlite',
  '.sqlite3', '.mdb', '.dat', '.pack', '.idx', '.resources', '.baml', '.pfx', '.p12',
]));

/** True when the path's extension is a known-binary one. */
export function hasBinaryExtension(filePath) {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/** True when the buffer's head contains a NUL byte (classic binary sniff). */
export function looksBinary(buf) {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0x00) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Language detection
//
// TypeScript and Dockerfile use LanguageRegistry as their authority. The
// compatibility tables retain the scanner's established output for other
// languages, including the explicitly frozen registry/scanner debt for
// jsonc, env/dot-env, svg, mk, OpenAPI, docker-compose, rst, and txt/text.
// Those differences require a separate contract migration.
// ---------------------------------------------------------------------------

/**
 * Extension -> language id. Lowercase keys; lookup is `.ext.toLowerCase()`.
 * Includes the legacy Step-3 mapping (.cfg/.ini/.env -> `config`) — note
 * that `config` is a language id here, not a category. Category routing
 * for these extensions is handled separately in CATEGORY_BY_EXT.
 */
const LANGUAGE_BY_EXT = Object.freeze({
  // JavaScript (TypeScript is canonical-registry-owned)
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  // Python
  '.py': 'python',
  '.pyi': 'python',
  // Go / Rust / Java / Kotlin / Scala / C# / Swift / Lua
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sc': 'scala',
  '.sbt': 'scala',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.lua': 'lua',
  // Ruby / PHP
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.php': 'php',
  // C / C++
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  // Vue / Svelte (no tree-sitter extractor, but project-scanner contract
  // lists them as code languages — downstream import map will return [])
  '.vue': 'vue',
  '.svelte': 'svelte',
  // Shell / Batch / PowerShell
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',
  // Markup / docs
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.rst': 'markdown',
  // Config / data
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.toml': 'toml',
  '.xml': 'xml',
  '.xsl': 'xml',
  '.xsd': 'xml',
  '.plist': 'xml',
  '.cfg': 'config',
  '.ini': 'config',
  '.env': 'config',
  // Data / schema
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.prisma': 'prisma',
  '.csv': 'csv',
  '.tsv': 'csv',
  // Infra
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  // JVM build files (categorized via filename-or-extension)
  '.gradle': 'gradle',
  // .NET project files (mapped to extension-derived ids; downstream
  // treats them as config — see CATEGORY_BY_EXT)
  '.csproj': 'csproj',
  '.sln': 'sln',
  '.properties': 'properties',
  '.mod': 'mod',
  '.sum': 'sum',
});

/**
 * Filename (no extension) -> language id. Compared case-sensitively against
 * basename(path). Includes the most common no-extension conventions; anything
 * NOT in this table with no extension falls back to `unknown`.
 *
 */
const LANGUAGE_BY_FILENAME = Object.freeze({
  // Conventional extension-less text files. Named here so they keep a
  // language and stay in the census instead of landing in the
  // `unknown-language` skip bucket — a repository's LICENSE and CHANGELOG are
  // real inputs, and a reader looking for them must be able to find them.
  LICENSE: 'text',
  LICENCE: 'text',
  COPYING: 'text',
  COPYRIGHT: 'text',
  NOTICE: 'text',
  AUTHORS: 'text',
  CONTRIBUTORS: 'text',
  CONTRIBUTING: 'text',
  CHANGELOG: 'text',
  CHANGES: 'text',
  HISTORY: 'text',
  README: 'text',
  INSTALL: 'text',
  TODO: 'text',
  VERSION: 'text',
  CODEOWNERS: 'text',
  Makefile: 'makefile',
  GNUmakefile: 'makefile',
  makefile: 'makefile',
  Jenkinsfile: 'jenkinsfile',
  Procfile: 'procfile',
  Vagrantfile: 'vagrantfile',
});

/**
 * Detect the language of a file by its path. Lowercase extension lookup,
 * then no-extension filename lookup. Never returns null — falls back to
 * the lowercased extension (without dot) or 'unknown' if there is no
 * extension. Downstream consumers rely on this field always being a string
 * (see project-scanner.md Step 3 "Fallback" note).
 */
export function detectLanguage(filePath) {
  return classifyLanguage(filePath).language;
}

/**
 * Same lookup as detectLanguage, but it also reports whether the answer came
 * from a DECLARED table entry or from the bare-extension fallback.
 *
 * The distinction is the `unknown-language` skip bucket: `.html` is a declared
 * language with no extractor (it goes to extraction and comes back
 * `no-extractor`), whereas `.xyz` is a language this pipeline has never heard
 * of — handing it to extraction would only manufacture a false "no extractor
 * for xyz" finding for every junk extension in the tree.
 */
export function classifyLanguage(filePath) {
  const base = basename(filePath);
  const ext = extname(filePath).toLowerCase();

  // These two migrated languages share the core registry's exact filename ->
  // basename pattern -> extension matcher. No scanner-local TS/Dockerfile
  // rule is authoritative.
  const canonical = canonicalLanguageRegistry.getForFile(filePath);
  if (canonical?.id === 'typescript' || canonical?.id === 'dockerfile') {
    return { language: canonical.id, declared: true };
  }

  // Dotfile names like .env, .env.local — path.extname returns '' for
  // single-segment dotfiles (e.g. '.env') and the SECOND segment for
  // compound dotfiles (e.g. '.local' for '.env.local'). Neither hits the
  // intended LANGUAGE_BY_EXT['.env'] mapping. Try the leading dotfile
  // portion first so `.env`, `.env.local`, `.env.production` all map.
  const dotKey = dotfileKey(base);
  if (dotKey && LANGUAGE_BY_EXT[dotKey]) {
    return { language: LANGUAGE_BY_EXT[dotKey], declared: true };
  }

  if (ext) {
    const byExt = LANGUAGE_BY_EXT[ext];
    if (byExt) return { language: byExt, declared: true };
    // Unknown extension → drop the leading dot, lowercase. Never null.
    return { language: ext.slice(1), declared: false };
  }

  // No-extension file — try filename table.
  const byFilename = LANGUAGE_BY_FILENAME[base];
  if (byFilename) return { language: byFilename, declared: true };

  return { language: 'unknown', declared: false };
}

/**
 * Extract the canonical dotfile "extension" from a basename, or null.
 *
 * `.env`          -> `.env`
 * `.env.local`    -> `.env`
 * `.bashrc`       -> `.bashrc`
 * `package.json`  -> null (not a dotfile)
 *
 * Used by both detectLanguage and detectCategory so dotfile-style configs
 * (e.g., `.env`, `.env.local`, `.env.production`) get their leading
 * segment treated as the implicit extension instead of falling through
 * to `unknown` / `code`.
 */
function dotfileKey(base) {
  if (!base.startsWith('.')) return null;
  const m = base.match(/^(\.[a-z0-9]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Category detection
//
// Implements the priority-ordered rules from project-scanner.md Step 4.
// Order matters: more specific rules must run before more general ones
// (e.g. `docker-compose.yml` is infra, not config).
//
// Categories: code | config | docs | infra | data | script | markup
// ---------------------------------------------------------------------------

/**
 * Extension -> category. Used only after the higher-priority path-based
 * checks (infra/docs exclusions) in `detectCategory()`. Plain extension
 * lookup is intentionally last-resort — many configs need their full path
 * inspected first.
 */
const CATEGORY_BY_EXT = Object.freeze({
  // docs
  '.md': 'docs',
  '.mdx': 'docs',
  '.rst': 'docs',
  '.txt': 'docs',
  '.text': 'docs',
  // config
  '.yaml': 'config',
  '.yml': 'config',
  '.json': 'config',
  '.jsonc': 'config',
  '.toml': 'config',
  '.xml': 'config',
  '.xsl': 'config',
  '.xsd': 'config',
  '.plist': 'config',
  '.cfg': 'config',
  '.ini': 'config',
  '.env': 'config',
  '.properties': 'config',
  '.csproj': 'config',
  '.sln': 'config',
  '.mod': 'config',
  '.sum': 'config',
  '.gradle': 'config',
  '.sbt': 'config',
  // infra
  '.tf': 'infra',
  '.tfvars': 'infra',
  // data
  '.sql': 'data',
  '.graphql': 'data',
  '.gql': 'data',
  '.proto': 'data',
  '.prisma': 'data',
  '.csv': 'data',
  '.tsv': 'data',
  // script
  '.sh': 'script',
  '.bash': 'script',
  '.zsh': 'script',
  '.ps1': 'script',
  '.psm1': 'script',
  '.psd1': 'script',
  '.bat': 'script',
  '.cmd': 'script',
  // markup
  '.html': 'markup',
  '.htm': 'markup',
  '.css': 'markup',
  '.scss': 'markup',
  '.sass': 'markup',
  '.less': 'markup',
});

/**
 * Filenames (no extension or full filename with extension) that always
 * map to `infra` regardless of their extension. Compared case-sensitively
 * against basename(path).
 */
const INFRA_FILENAMES = new Set([
  '.dockerignore',
  'Makefile',
  'GNUmakefile',
  'makefile',
  'Jenkinsfile',
  'Procfile',
  'Vagrantfile',
  '.gitlab-ci.yml',
]);

/**
 * Detect the project-scanner category for a file. Priority order matches
 * project-scanner.md Step 4 "Priority rule" — most specific wins.
 *
 * 1. LICENSE -> code (per the spec note "except LICENSE"). The Step-2
 *    exclusion table normally removes LICENSE, but if a project chooses to
 *    re-include it via `.excavatorignore` negation, it should NOT land in
 *    docs. We classify as `code` rather than inventing a new bucket.
 * 2. Canonical Dockerfile language or filename-based infra (Makefile,
 *    Jenkinsfile, docker-compose.*, Vagrantfile, Procfile, .gitlab-ci.yml,
 *    .dockerignore).
 * 3. Path-based infra (.github/workflows/, .circleci/, k8s/, kubernetes/,
 *    *.k8s.yml, *.k8s.yaml).
 * 4. Extension-based mapping (CATEGORY_BY_EXT).
 * 5. Fallback: `code` (matches the spec — "All other extensions").
 */
export function detectCategory(filePath, canonicalLanguage = classifyLanguage(filePath).language) {
  const base = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const posix = filePath.split(sep).join('/');

  // Rule 1: LICENSE exception (project-scanner.md Step 4 table comment).
  if (base === 'LICENSE') return 'code';

  // Canonical Dockerfile matching includes exact, dot, and hyphen variants.
  if (canonicalLanguage === 'dockerfile') return 'infra';

  // Rule 2: infra by filename — Makefile, Jenkinsfile, docker-compose.*,
  // Procfile, Vagrantfile, .gitlab-ci.yml, .dockerignore.
  if (INFRA_FILENAMES.has(base)) return 'infra';
  if (base.startsWith('docker-compose.')) return 'infra';
  if (base === 'compose.yml' || base === 'compose.yaml') return 'infra';

  // Rule 3: infra by path.
  if (posix.startsWith('.github/workflows/')) return 'infra';
  if (posix.startsWith('.circleci/')) return 'infra';
  // Match a `k8s/` or `kubernetes/` segment anywhere in the path.
  if (/(^|\/)(k8s|kubernetes)\//.test(posix)) return 'infra';
  // `*.k8s.yml` and `*.k8s.yaml` — Kubernetes-flavored YAML.
  if (/\.k8s\.(ya?ml)$/i.test(base)) return 'infra';

  // Rule 4: extension-based lookup.
  if (ext) {
    const byExt = CATEGORY_BY_EXT[ext];
    if (byExt) return byExt;
  }

  // Rule 4.5: dotfile-style configs (.env, .env.local, .env.production).
  // path.extname misses these — see dotfileKey docstring.
  const dotKey = dotfileKey(base);
  if (dotKey) {
    const byDot = CATEGORY_BY_EXT[dotKey];
    if (byDot) return byDot;
  }

  // Rule 5: filename-based config catch-all for no-extension config files
  // commonly seen in JVM/Go/.NET projects (covered above for infra but not
  // config). We don't enumerate every possible config filename here — that
  // gets handled by the language map's no-extension entries upstream.
  // Anything not matched falls through to `code`.
  return 'code';
}

/**
 * Merge an authoritative SourceSnapshot selection ledger with processing
 * outcomes produced by scanning its selected-only materialization. Excluded
 * candidates are restored as safe metadata records; their bytes never need
 * to exist in the materialized tree.
 */
export function mergeSnapshotSelection(scan, selection, snapshotProcessingSkips = []) {
  if (!selection || !Array.isArray(selection.entries)) {
    throw new Error('mergeSnapshotSelection: selection.entries must be an array');
  }
  const decisionByPath = new Map(selection.entries.map((entry) => [entry.path, entry]));
  if (decisionByPath.size !== selection.entries.length) {
    throw new Error('mergeSnapshotSelection: duplicate snapshot selection path');
  }

  const processing = [
    ...(scan.skipped ?? []).filter((entry) => ![
      'filtered-by-defaults', 'filtered-by-ignore', 'sensitive',
    ].includes(entry.reason)),
    ...snapshotProcessingSkips.map((entry) => ({
      ...entry,
      language: entry.language ?? detectLanguage(entry.path),
    })),
  ];
  const outcomes = new Set((scan.files ?? []).map((entry) => entry.path));
  for (const entry of processing) {
    if (outcomes.has(entry.path)) {
      throw new Error(`mergeSnapshotSelection: duplicate processing outcome for ${entry.path}`);
    }
    outcomes.add(entry.path);
  }
  for (const path of outcomes) {
    if (decisionByPath.get(path)?.kind !== 'selected') {
      throw new Error(`mergeSnapshotSelection: processing outcome ${path} is not snapshot-selected`);
    }
  }
  for (const decision of selection.entries) {
    if (decision.kind === 'selected' && !outcomes.has(decision.path)) {
      throw new Error(`mergeSnapshotSelection: selected candidate ${decision.path} has no processing outcome`);
    }
  }

  const excluded = selection.entries
    .filter((entry) => entry.kind !== 'selected')
    .map((entry) => ({
      path: entry.path,
      reason: entry.reason,
      language: detectLanguage(entry.path),
      detail: entry.detail,
      ...(entry.kind === 'sensitive' && entry.size !== undefined ? { size: entry.size } : {}),
    }));
  const skipped = [...excluded, ...processing]
    .sort((a, b) => compareStableStrings(a.path, b.path) || compareStableStrings(a.reason, b.reason));
  const skippedByReason = {};
  for (const entry of skipped) skippedByReason[entry.reason] = (skippedByReason[entry.reason] || 0) + 1;

  return {
    ...scan,
    selection: JSON.parse(JSON.stringify(selection)),
    filteredByIgnore: selection.filteredByIgnore,
    filteredByDefaults: selection.filteredByDefaults,
    skipped,
    stats: { ...(scan.stats ?? {}), skippedByReason },
  };
}

// ---------------------------------------------------------------------------
// Complexity estimation (project-scanner.md Step 7)
// ---------------------------------------------------------------------------

/**
 * Map a total file count to a complexity tier. Thresholds are inclusive on
 * the lower bound:
 *   - small:      1-30
 *   - moderate:   31-150
 *   - large:      151-500
 *   - very-large: >500
 *
 * Edge case: 0 files maps to `small` (the lowest tier) so the field is
 * always set even on empty repos. Downstream consumers treat 0 files as
 * a sentinel for "nothing to analyze" via `totalFiles`, not complexity.
 */
export function estimateComplexity(totalFiles) {
  if (totalFiles <= 30) return 'small';
  if (totalFiles <= 150) return 'moderate';
  if (totalFiles <= 500) return 'large';
  return 'very-large';
}

// ---------------------------------------------------------------------------
// File enumeration
// ---------------------------------------------------------------------------

/**
 * Normalize a path to forward-slash POSIX. The project-scanner contract
 * emits POSIX paths; we re-normalize so the output is stable across
 * Windows/macOS/Linux.
 */
function toPosix(p) {
  return p.split(sep).join('/');
}

/**
 * Locale-independent string order. ECMAScript relational string comparison
 * is lexicographic over UTF-16 code units, so the result cannot vary with ICU,
 * process locale, or operating system settings.
 */
function compareStableStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Enumerate all files in `projectRoot` via `git ls-files`. Returns an
 * array of project-relative POSIX paths, or null if the directory is not
 * a git repository (or git is not installed). Caller falls back to the
 * recursive walker.
 *
 * Why git ls-files first: it respects the repo's `.gitignore`, handles
 * submodules sensibly, and gives a fast, deterministic listing. The walker
 * is a strict superset of what git would emit (no .gitignore awareness),
 * so the ignore filter has to do more work in the fallback path.
 */
function enumerateViaGit(projectRoot) {
  // -z = NUL-terminated output. Without it, `git ls-files` C-escapes non-ASCII
  // bytes in path names — paths containing emoji, accented characters, CJK
  // codepoints, etc. come back quoted with octal escapes (e.g.
  // `"30. \360\237\217\227 BD-CCER/file.md"` for a path containing 🏗️).
  // Those quoted-escaped strings then fail to round-trip back to real disk
  // paths in downstream consumers, so files in such directories are silently
  // dropped from the scan. The -z form emits raw bytes between NUL separators,
  // preserving every codepoint as-is. This is the same approach git itself
  // uses for `--null` everywhere downstream (xargs -0, etc.).
  const result = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024, // 256MB — huge monorepos can produce >10MB of paths
  });
  if (result.status !== 0 || !result.stdout) return null;
  // Each NUL-separated chunk is one path, project-relative, already POSIX on
  // all platforms because git emits forward slashes regardless of OS.
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map(toPosix);
}

// Hard skip — these directories are universally non-source (or, for the
// plugin/agent and data directories, never analysis input) and skipping at
// the walker level avoids materializing thousands of paths before the
// ignore filter would drop them anyway. The ignore filter still runs on
// everything else. Every entry here MUST also be a DEFAULT_IGNORE_PATTERNS
// entry in core's ignore-filter.ts (checked by a unit test) — this is a
// walker-only performance subset, not a second source of truth.
const HARD_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.claude',
  '.agents',
  '.codex',
  '.excavator',
]);

// `.excavator` variant/backup directories (e.g. `.excavator.slicec-bak`,
// `.excavator-old`) and `.trash-*` recycle directories have no fixed name —
// a Set of exact names can't express them — so the walker also recognizes
// them structurally, matching core's DEFAULT_IGNORE_PATTERNS shapes
// (`.excavator.*/`, `.excavator-*/`, `.trash-*/`) exactly. Same "walker-only
// performance subset" contract as HARD_SKIP_DIRS above: every name this
// returns true for MUST also be excluded by core's real ignore filter
// (checked by a unit test) — this function does not decide correctness by
// itself, the ignore filter still runs on everything the walker keeps.
function isHardSkipDir(name) {
  if (HARD_SKIP_DIRS.has(name)) return true;
  if (name.startsWith('.excavator.') || name.startsWith('.excavator-')) return true;
  if (name.startsWith('.trash-')) return true;
  return false;
}

/**
 * Recursive directory walker — fallback when `git ls-files` is unavailable
 * (no git, not a repo, or git refused). Skips hard-coded "obviously bad"
 * directory names BEFORE invoking the ignore filter so we don't waste cycles
 * descending into `node_modules/` etc. on huge trees.
 *
 * Yields project-relative POSIX paths in directory-sorted order so the
 * output is deterministic without an extra sort pass.
 */
function enumerateViaWalk(projectRoot) {
  const out = [];

  function walk(absDir) {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      process.stderr.write(
        `Warning: scan-project: ${toPosix(relative(projectRoot, absDir)) || '.'} ` +
        `— directory read failed (${err.message}) — subtree skipped\n`,
      );
      return;
    }
    // Sort deterministically by name; mix files and dirs together so the
    // final output (after the path sort) is identical regardless of
    // OS-specific readdir order.
    entries.sort((a, b) => compareStableStrings(a.name, b.name));
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (isHardSkipDir(ent.name)) continue;
        walk(join(absDir, ent.name));
      } else if (ent.isFile()) {
        const rel = toPosix(relative(projectRoot, join(absDir, ent.name)));
        if (rel) out.push(rel);
      }
      // Symlinks intentionally ignored — git ls-files doesn't follow them
      // either, and following them is a classic recursion-bomb footgun.
    }
  }

  walk(projectRoot);
  return out;
}

/**
 * Enumerate all candidate files in `projectRoot`. Tries git ls-files first;
 * falls back to a recursive walk if git is unavailable or this is not a
 * repo. Returns an array of project-relative POSIX paths in unspecified
 * order — caller is responsible for sorting + filtering.
 */
function enumerateFiles(projectRoot) {
  const fromGit = enumerateViaGit(projectRoot);
  if (fromGit !== null) return fromGit;
  process.stderr.write(
    `scan-project: git ls-files unavailable — falling back to recursive walk\n`,
  );
  return enumerateViaWalk(projectRoot);
}

// ---------------------------------------------------------------------------
// Selection inputs
// ---------------------------------------------------------------------------

function ignoreLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').split('\n').filter((line) => line.length > 0);
}

function currentProjectPatterns(projectRoot) {
  return [
    ...ignoreLines(join(resolveDataDir(projectRoot), '.excavatorignore')),
    ...ignoreLines(join(projectRoot, '.excavatorignore')),
  ];
}

function readBoundedPrefix(absPath) {
  let descriptor;
  try {
    descriptor = openSync(absPath, 'r');
    const buffer = Buffer.alloc(PRIVATE_KEY_PREFIX_BYTES);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

// ---------------------------------------------------------------------------
// Line counting
// ---------------------------------------------------------------------------

/**
 * Read a file once and count its newline-delimited lines. Returns both the raw
 * bytes and the number of `\n` characters; the caller feeds those same bytes
 * directly into the content digest without a second read or a whole-repo
 * content concatenation. The count matches `wc -l` semantics.
 *
 * Per-file failure: emits a Warning: and returns null. Caller decides
 * whether to drop the file or keep it with sizeLines=0.
 */
function readAndCountLines(absPath, posixPath, failures) {
  try {
    const buf = readFileSync(absPath);
    // Manual newline count beats split('\n').length on large files — no
    // intermediate array allocation. We count the `\n` byte (0x0a) directly.
    let count = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) count++;
    }
    return { bytes: buf, sizeLines: count };
  } catch (err) {
    failures.push({ path: posixPath, stage: 'file-read', message: err.message });
    process.stderr.write(
      `Warning: scan-project: ${posixPath} — line count failed ` +
      `(${err.message}) — file skipped from output\n`,
    );
    return null;
  }
}

const CONTENT_DIGEST_DOMAIN = Buffer.from('excavator:scan-content:v1\0', 'utf-8');

/**
 * Add one scanned regular file to the aggregate fingerprint. Entries arrive
 * in compareStableStrings path order. Each frame is:
 *   uint32be(path UTF-8 byte length) || uint64be(content byte length) ||
 *   UTF-8 path bytes || raw content bytes
 * Length prefixes make path/content and adjacent-entry boundaries unambiguous.
 */
function updateContentDigest(hash, posixPath, contentBytes) {
  const pathBytes = Buffer.from(posixPath, 'utf-8');
  const lengths = Buffer.allocUnsafe(12);
  lengths.writeUInt32BE(pathBytes.length, 0);
  lengths.writeBigUInt64BE(BigInt(contentBytes.length), 4);
  hash.update(lengths);
  hash.update(pathBytes);
  hash.update(contentBytes);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  let projectRoot;
  let outputPath;
  const excludePatterns = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--exclude-analysis-data') {
      // Kept as a caller-facing spelling; hard safety always excludes it.
      continue;
    }
    if (arg === '--exclude') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        process.stderr.write('scan-project.mjs failed: --exclude requires patterns\n');
        process.exit(1);
      }
      excludePatterns.push(
        ...value
          .split(',')
          .map(pattern => pattern.trim())
          .filter(Boolean),
      );
      i++;
      continue;
    }
    if (arg.startsWith('--')) {
      process.stderr.write(`scan-project.mjs failed: unknown option: ${arg}\n`);
      process.exit(1);
    }
    if (!projectRoot) {
      projectRoot = arg;
      continue;
    }
    if (!outputPath) {
      outputPath = arg;
      continue;
    }
    process.stderr.write(`scan-project.mjs failed: unexpected argument: ${arg}\n`);
    process.exit(1);
  }

  if (!projectRoot || !outputPath) {
    process.stderr.write(
      'Usage: node scan-project.mjs <projectRoot> <outputPath> ' +
      '[--exclude <patterns>] [--exclude-analysis-data]\n',
    );
    process.exit(1);
  }

  if (!existsSync(projectRoot)) {
    process.stderr.write(
      `scan-project.mjs failed: projectRoot does not exist: ${projectRoot}\n`,
    );
    process.exit(1);
  }
  const projectRootStat = statSync(projectRoot);
  if (!projectRootStat.isDirectory()) {
    process.stderr.write(
      `scan-project.mjs failed: projectRoot is not a directory: ${projectRoot}\n`,
    );
    process.exit(1);
  }

  const failures = [];

  // 1. Enumerate. Either git ls-files or recursive walk.
  const candidates = enumerateFiles(projectRoot);

  // 2. Apply the shared pre-extraction policy. Only a bounded prefix may be
  //    read here, and no sensitive decision contains those bytes or a hash.
  const selectionPolicy = createSourceSelectionPolicy({
    projectPatterns: currentProjectPatterns(projectRoot),
    cliPatterns: excludePatterns,
  });
  const selectionDecisions = [];
  const kept = [];
  // Every enumerated file that is not emitted lands here with the reason it
  // was dropped, so the coverage ledger can account for it by name.
  const skipped = [];
  const recordSkip = (rel, reason, safeMetadata = {}) => {
    skipped.push({ path: rel, reason, language: detectLanguage(rel), ...safeMetadata });
  };
  for (const rel of candidates) {
    const absPath = join(projectRoot, rel);
    let stat;
    try {
      stat = lstatSync(absPath);
    } catch {
      // The processing pass below owns the visible read-failed result.
    }
    const initial = selectionPolicy.decide({ path: rel, size: stat?.size });
    const mayNeedHeader = stat?.isFile()
      && initial.kind !== 'sensitive'
      && !(initial.kind === 'filtered-by-defaults' && ['analysis-data', 'archive'].includes(initial.detail));
    const decision = mayNeedHeader
      ? selectionPolicy.decide({ path: rel, size: stat.size, contentPrefix: readBoundedPrefix(absPath) })
      : initial;
    selectionDecisions.push(decision);
    if (decision.kind === 'selected') {
      kept.push(rel);
    } else {
      recordSkip(
        rel,
        decision.reason,
        decision.kind === 'sensitive'
          ? { detail: decision.detail, ...(decision.size === undefined ? {} : { size: decision.size }) }
          : { detail: decision.detail },
      );
    }
  }
  const selection = buildSourceSelectionLedger(selectionDecisions);
  const filteredByDefaults = selection.filteredByDefaults;
  const filteredByIgnore = selection.filteredByIgnore;

  // The per-file pass, output, stats key insertion, and content fingerprint
  // all consume this one locale-independent path order.
  kept.sort(compareStableStrings);

  // 3. Per-file: language + category + line count.
  //    Drop files that fail line counting (per-file resilience).
  const fileEntries = [];
  const contentHash = createHash('sha256');
  contentHash.update(CONTENT_DIGEST_DOMAIN);
  for (const rel of kept) {
    const absPath = join(projectRoot, rel);
    // lstat first so Git-enumerated symlinks are rejected before any operation
    // can follow them to a repository-external target.
    let stat;
    try {
      stat = lstatSync(absPath);
      if (stat.isSymbolicLink()) {
        recordSkip(rel, 'symlink');
        process.stderr.write(
          `Warning: scan-project: ${rel} — symbolic link skipped ` +
          `— file skipped from output\n`,
        );
        continue;
      }
      if (!stat.isFile()) {
        // Directories and special files are not scanned as regular-file input.
        continue;
      }
    } catch (err) {
      failures.push({ path: rel, stage: 'file-lstat', message: err.message });
      recordSkip(rel, 'read-failed');
      process.stderr.write(
        `Warning: scan-project: ${rel} — lstat failed (${err.message}) ` +
        `— file skipped from output\n`,
      );
      continue;
    }

    // Known-binary extension: decided from the path, so a huge artifact is
    // never read into memory.
    if (hasBinaryExtension(rel)) {
      recordSkip(rel, 'binary');
      continue;
    }

    // Byte limit from stat, again to avoid reading what we would then drop.
    if (stat.size > MAX_FILE_BYTES) {
      recordSkip(rel, 'too-large');
      process.stderr.write(
        `Warning: scan-project: ${rel} — ${stat.size} bytes exceeds ` +
        `MAX_FILE_BYTES=${MAX_FILE_BYTES} — file skipped from output\n`,
      );
      continue;
    }

    const scanned = readAndCountLines(absPath, rel, failures);
    if (scanned === null) {
      // readAndCountLines already emitted the Warning: line.
      recordSkip(rel, 'read-failed');
      continue;
    }

    // No known-binary extension, but the content says otherwise.
    if (looksBinary(scanned.bytes)) {
      recordSkip(rel, 'binary');
      continue;
    }

    if (scanned.sizeLines > MAX_FILE_LINES) {
      recordSkip(rel, 'too-large');
      process.stderr.write(
        `Warning: scan-project: ${rel} — ${scanned.sizeLines} lines exceeds ` +
        `MAX_FILE_LINES=${MAX_FILE_LINES} — file skipped from output\n`,
      );
      continue;
    }

    // The scanner cannot even NAME this file's language: no extension and no
    // filename-table match. An unrecognised *extension* is different — it
    // still names a language ("log", "xaml"), keeps its census node, and comes
    // back from extraction as `no-extractor`, which is the honest finding.
    const { language, declared } = classifyLanguage(rel);
    if (!declared && language === 'unknown') {
      recordSkip(rel, 'unknown-language');
      continue;
    }

    updateContentDigest(contentHash, rel, scanned.bytes);
    fileEntries.push({
      path: rel,
      language,
      sizeLines: scanned.sizeLines,
      fileCategory: detectCategory(rel, language),
    });
  }

  // 4. Determinism: preserve the documented locale-independent path order.
  fileEntries.sort((a, b) => compareStableStrings(a.path, b.path));
  const contentDigest = contentHash.digest('hex');

  // 5. Stats.
  const byCategory = {};
  const byLanguage = {};
  for (const f of fileEntries) {
    byCategory[f.fileCategory] = (byCategory[f.fileCategory] || 0) + 1;
    byLanguage[f.language] = (byLanguage[f.language] || 0) + 1;
  }

  const estimatedComplexity = estimateComplexity(fileEntries.length);

  // Deterministic order for the skip ledger, independent of enumeration order.
  skipped.sort((a, b) => compareStableStrings(a.path, b.path) || compareStableStrings(a.reason, b.reason));
  const skippedByReason = {};
  for (const entry of skipped) {
    skippedByReason[entry.reason] = (skippedByReason[entry.reason] || 0) + 1;
  }

  const output = {
    scriptCompleted: true,
    contentDigest,
    selection,
    files: fileEntries,
    totalFiles: fileEntries.length,
    filteredByIgnore,
    filteredByDefaults,
    estimatedComplexity,
    failures,
    skipped,
    coverage: {
      limits: {
        maxFileLines: MAX_FILE_LINES,
        maxFileBytes: MAX_FILE_BYTES,
      },
    },
    stats: {
      filesScanned: fileEntries.length,
      byCategory,
      byLanguage,
      skippedByReason,
    },
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  if (!existsSync(outputPath)) {
    throw new Error(`output file missing after write: ${outputPath}`);
  }

  process.stderr.write(
    `scan-project: filesScanned=${fileEntries.length} ` +
    `filteredByIgnore=${filteredByIgnore} ` +
    `filteredByDefaults=${filteredByDefaults} ` +
    `complexity=${estimatedComplexity} ` +
    `skipped=${skipped.length}\n`,
  );
}

// ---------------------------------------------------------------------------
// Run only when executed directly as a CLI; importing the module (e.g. from
// tests) must not trigger main().
//
// Canonicalize both sides through realpathSync. Node ESM resolves
// import.meta.url through symlinks but pathToFileURL(process.argv[1]) preserves
// them, so a raw equality check silently no-ops when the script is invoked via
// a symlinked plugin install path (the default in Claude Code / Copilot CLI
// caches). See GitHub issue #162.
// ---------------------------------------------------------------------------
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const argvPath = realpathSync(process.argv[1]);
    return modulePath === argvPath;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`scan-project.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

// Default export of helpers for testability.
export default {
  detectLanguage,
  classifyLanguage,
  detectCategory,
  mergeSnapshotSelection,
  estimateComplexity,
  hasBinaryExtension,
  looksBinary,
  MAX_FILE_LINES,
  MAX_FILE_BYTES,
  BINARY_SNIFF_BYTES,
  HARD_SKIP_DIRS: Array.from(HARD_SKIP_DIRS),
  isHardSkipDir,
};
