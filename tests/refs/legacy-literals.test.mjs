// Legacy-literal gate (design D3): pnpm test must fail if any pre-rename
// literal (the old product name, the old ignore-file name, the old env var,
// or the old dot-prefixed data-dir token) leaks into a tracked file outside
// the accepted exemptions (NOTICE, docs/, openspec/, and two byte-matched
// upstream schema-URL lines in scripts/lib/large-repo-benchmark.mjs).
//
// The forbidden tokens are built from concatenated parts rather than typed
// literally, so this file's own source does not trip the very patterns it
// defines (the same convention used elsewhere in this suite for "prove no
// fallback" scenarios).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

const join_ = (parts) => parts.join('');

// The old product name, hyphenated (never the bare English verb "understand",
// which stays in prose per design D2).
const LEGACY_PRODUCT_NAME = join_(['under', 'stand', '-', 'any', 'thing']);
// The old ignore-file name.
const LEGACY_IGNORE_FILE = join_(['under', 'stand', 'ignore']);
// The old env var.
const LEGACY_ENV_VAR = join_(['U', 'A', '_DIR']);
// The old dot-prefixed data-dir token, as a regex source fragment (a literal
// dot, then the two letters, then a word boundary) — mirrors the oracle's
// own grep for that legacy directory shorthand.
const LEGACY_DATA_DIR = join_(['\\.', 'ua', '\\b']);

const LEGACY_LITERAL_PATTERNS = [
  new RegExp(LEGACY_PRODUCT_NAME, 'i'),
  new RegExp(LEGACY_IGNORE_FILE, 'i'),
  new RegExp(LEGACY_ENV_VAR, 'i'),
  new RegExp(LEGACY_DATA_DIR, 'i'),
];

// The two upstream schema-URL lines in scripts/lib/large-repo-benchmark.mjs
// that must keep pointing at the real upstream repo (it has to byte-match
// docs/benchmarks/*.schema.json's own $id, which is out of this change's
// scope). Exempted by exact line content, not by exempting the whole file.
const upstreamOrg = 'Egonex-AI';
const upstreamRepoName = join_(['Under', 'stand', '-', 'Anyth', 'ing']);
const EXEMPT_EXACT_LINES = new Set([
  `// NOTE: this URL intentionally still points at the upstream ${upstreamRepoName}`,
  `  'https://raw.githubusercontent.com/${upstreamOrg}/${upstreamRepoName}/main/docs/benchmarks/large-repo-report-1.0.0.schema.json';`,
]);

// Bare-slash agent/skill references, e.g. "/understand-file-analyzer" — this
// pattern's own source contains no hyphen directly after "understand", so it
// does not trip LEGACY_LITERAL_PATTERNS above when this file is itself
// scanned.
const SLASH_REFERENCE_PATTERN = /(^|[^a-z])\/understand(-[a-z]+)?\b/;

function isPathWideExempt(relPath) {
  return relPath === 'NOTICE' || relPath.startsWith('docs/') || relPath.startsWith('openspec/');
}

function readLines(baseDir, relPath) {
  try {
    return readFileSync(join(baseDir, relPath), 'utf-8').split('\n');
  } catch {
    return null; // unreadable/binary/missing — not this gate's concern
  }
}

/**
 * Pure matcher: scans an arbitrary list of repo-relative paths under
 * `baseDir` for legacy literals. Returns an array of violations (empty when
 * clean). Callable on the real repo's tracked-file list or on a synthetic
 * temp-dir file list (see the instrument tests below).
 */
function findLegacyLiteralViolations(baseDir, relPaths) {
  const violations = [];
  for (const rel of relPaths) {
    if (isPathWideExempt(rel)) continue;
    const lines = readLines(baseDir, rel);
    if (lines === null) continue;
    lines.forEach((line, idx) => {
      if (EXEMPT_EXACT_LINES.has(line)) return;
      for (const pattern of LEGACY_LITERAL_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({ file: rel, line: idx + 1, excerpt: line.trim().slice(0, 200) });
          return;
        }
      }
    });
  }
  return violations;
}

/**
 * Pure matcher: scans skills/, agents/, hooks/ paths for bare slash-prefixed
 * references to the old product/agent naming scheme.
 */
function findSlashReferenceViolations(baseDir, relPaths) {
  const violations = [];
  for (const rel of relPaths) {
    if (!(rel.startsWith('skills/') || rel.startsWith('agents/') || rel.startsWith('hooks/'))) continue;
    const lines = readLines(baseDir, rel);
    if (lines === null) continue;
    lines.forEach((line, idx) => {
      if (SLASH_REFERENCE_PATTERN.test(line)) {
        violations.push({ file: rel, line: idx + 1, excerpt: line.trim().slice(0, 200) });
      }
    });
  }
  return violations;
}

function gitTrackedFiles(pathspecs = []) {
  return execFileSync('git', ['ls-files', ...pathspecs], { cwd: repoRoot, encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean);
}

describe('legacy-literal gate (design D3)', () => {
  it('no tracked file outside NOTICE/docs/openspec carries a legacy literal', () => {
    const files = gitTrackedFiles();
    const violations = findLegacyLiteralViolations(repoRoot, files);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it('skills/, agents/, hooks/ carry no bare slash-prefixed legacy references', () => {
    const files = gitTrackedFiles(['skills', 'agents', 'hooks']);
    const violations = findSlashReferenceViolations(repoRoot, files);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  describe('instrument: the matcher must actually see a planted literal', () => {
    let tmpDir;

    afterEach(() => {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('flags a temp file containing the legacy data-dir literal', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'legacy-literal-instrument-'));
      const plantedToken = join_(['.', 'ua', '/config.json']);
      writeFileSync(join(tmpDir, 'planted.txt'), `stale reference: ${plantedToken}\n`);

      const violations = findLegacyLiteralViolations(tmpDir, ['planted.txt']);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].file).toBe('planted.txt');
    });

    it('does not flag NOTICE-style content even when it names the upstream project', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'legacy-literal-exempt-'));
      writeFileSync(join(tmpDir, 'NOTICE'), `Forked from ${upstreamRepoName}.\n`);

      const violations = findLegacyLiteralViolations(tmpDir, ['NOTICE']);
      expect(violations).toEqual([]);
    });

    it('reports nothing for a clean file with none of the legacy tokens', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'legacy-literal-clean-'));
      writeFileSync(join(tmpDir, 'clean.txt'), 'ordinary prose about understanding a codebase.\n');

      const violations = findLegacyLiteralViolations(tmpDir, ['clean.txt']);
      expect(violations).toEqual([]);
    });
  });
});
