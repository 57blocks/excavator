/**
 * coverage-ledger.mjs
 *
 * Folds the deterministic passes' outputs (scan + full-project structure +
 * import map) into ONE per-language ledger plus the gap list it implies.
 *
 * The invariant this module exists to make checkable, per language:
 *
 *     files = parsed + zeroSymbol + Σ skipped[reason]
 *
 * so no scanned input can sit in an unaccounted-for state. `skipped` therefore
 * carries BOTH scan-time reasons (symlink / read-failed / unknown-language /
 * binary / too-large / ignored) and the extraction outcomes that produced no
 * symbols for a reason other than the file being empty (`no-extractor`,
 * `parse-failed`) — one map answering "why was this file not parsed?".
 *
 * No model, no I/O: pure functions over already-produced JSON.
 */

/** Reasons the scanner can attach to a file it did not emit. */
export const SCAN_SKIP_REASONS = Object.freeze([
  'symlink', 'read-failed', 'unknown-language', 'binary', 'too-large', 'ignored',
]);

/** Extraction statuses that mean "handed to a reader, produced no symbols". */
export const EXTRACTION_SKIP_STATUSES = Object.freeze(['no-extractor', 'parse-failed']);

/** Every key that may appear in `coverage.byLanguage[lang].skipped`. */
export const SKIP_REASONS = Object.freeze([
  ...SCAN_SKIP_REASONS,
  ...EXTRACTION_SKIP_STATUSES,
]);

const KIND_FIELDS = Object.freeze(['function', 'class', 'import', 'export', 'call']);

function emptyLanguage() {
  return {
    files: 0,
    parsed: 0,
    zeroSymbol: 0,
    skipped: {},
    kinds: { function: 0, class: 0, import: 0, export: 0, call: 0 },
  };
}

function bucket(byLanguage, language) {
  const key = language || 'unknown';
  if (!byLanguage[key]) byLanguage[key] = emptyLanguage();
  return byLanguage[key];
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Build the coverage table and the gaps it implies.
 *
 * @param {object} args
 * @param {object} args.scan        scan-project.mjs output
 * @param {object} args.structure   extract-structure.mjs output over ALL files
 * @param {object} [args.importMap] extract-import-map.mjs output
 * @param {number} [args.sampleLimit] max samples kept per gap
 * @returns {{coverage: object, gaps: object[]}}
 */
export function buildCoverageLedger({ scan, structure, importMap, sampleLimit = 5 }) {
  if (!scan || !Array.isArray(scan.files)) {
    throw new Error('buildCoverageLedger: scan.files must be an array');
  }
  if (!structure || !Array.isArray(structure.results)) {
    throw new Error('buildCoverageLedger: structure.results must be an array');
  }

  const byLanguage = {};
  const languageOfPath = new Map();

  // 1. Scanned (emitted) files: one row each, language from the scan.
  for (const file of scan.files) {
    languageOfPath.set(file.path, file.language);
    bucket(byLanguage, file.language).files += 1;
  }

  // 2. Skipped files: same table, counted under their reason.
  const skipSamples = {};
  for (const entry of scan.skipped ?? []) {
    if (!SCAN_SKIP_REASONS.includes(entry.reason)) {
      throw new Error(`buildCoverageLedger: unknown scan skip reason "${entry.reason}" for ${entry.path}`);
    }
    const lang = entry.language || 'unknown';
    const row = bucket(byLanguage, lang);
    row.files += 1;
    row.skipped[entry.reason] = (row.skipped[entry.reason] || 0) + 1;
    const key = `${entry.reason}|${lang}`;
    if (!skipSamples[key]) skipSamples[key] = [];
    if (skipSamples[key].length < sampleLimit) skipSamples[key].push(entry.path);
  }

  // 3. Extraction statuses for the emitted files.
  const statusSamples = {};
  const seen = new Set();
  for (const result of structure.results) {
    if (seen.has(result.path)) {
      throw new Error(`buildCoverageLedger: duplicate structure result for ${result.path}`);
    }
    seen.add(result.path);
    const lang = result.language || languageOfPath.get(result.path) || 'unknown';
    const row = bucket(byLanguage, lang);
    const status = result.status;
    if (status === 'parsed') {
      row.parsed += 1;
    } else if (status === 'zero-symbol') {
      row.zeroSymbol += 1;
    } else if (EXTRACTION_SKIP_STATUSES.includes(status)) {
      row.skipped[status] = (row.skipped[status] || 0) + 1;
      const key = `${status}|${lang}`;
      if (!statusSamples[key]) statusSamples[key] = [];
      if (statusSamples[key].length < sampleLimit) statusSamples[key].push(result.path);
    } else {
      // Fail closed: a status outside the four is exactly the invisible
      // bucket this ledger exists to remove.
      throw new Error(
        `buildCoverageLedger: ${result.path} has unknown status ${JSON.stringify(status)}`,
      );
    }
    row.kinds.function += arrayLength(result.functions);
    row.kinds.class += arrayLength(result.classes);
    row.kinds.import += arrayLength(result.imports);
    row.kinds.export += arrayLength(result.exports);
    row.kinds.call += arrayLength(result.callGraph);
  }

  // 4. Unresolved import specifiers, per language of the importing file.
  const unresolvedByLanguage = {};
  for (const [path, specifiers] of Object.entries(importMap?.unresolved ?? {})) {
    const lang = languageOfPath.get(path) || 'unknown';
    if (!unresolvedByLanguage[lang]) unresolvedByLanguage[lang] = { count: 0, samples: [] };
    const row = unresolvedByLanguage[lang];
    row.count += specifiers.length;
    for (const specifier of specifiers) {
      if (row.samples.length < sampleLimit) row.samples.push(`${path} → ${specifier}`);
    }
  }

  const coverage = {
    files: Object.values(byLanguage).reduce((sum, row) => sum + row.files, 0),
    byLanguage: sortObjectKeys(byLanguage),
    ignored: (scan.skipped ?? []).filter((e) => e.reason === 'ignored').length,
    ...(scan.coverage?.limits ? { limits: scan.coverage.limits } : {}),
  };

  const gaps = [];
  for (const [language, row] of Object.entries(coverage.byLanguage)) {
    const noExtractor = row.skipped['no-extractor'] || 0;
    if (noExtractor > 0) {
      gaps.push({
        kind: 'no-extractor',
        scope: language,
        reason: `no structural reader is registered for ${language}; ${noExtractor} file(s) were read but not parsed`,
        count: noExtractor,
        samples: statusSamples[`no-extractor|${language}`] ?? [],
      });
    }
    const parseFailed = row.skipped['parse-failed'] || 0;
    if (parseFailed > 0) {
      gaps.push({
        kind: 'parse-failed',
        scope: language,
        reason: `the ${language} reader failed on ${parseFailed} file(s)`,
        count: parseFailed,
        samples: statusSamples[`parse-failed|${language}`] ?? [],
      });
    }
    for (const reason of SCAN_SKIP_REASONS) {
      const count = row.skipped[reason] || 0;
      if (count > 0 && reason !== 'ignored') {
        gaps.push({
          kind: `skipped-${reason}`,
          scope: language,
          reason: `${count} ${language} file(s) were skipped by the scanner: ${reason}`,
          count,
          samples: skipSamples[`${reason}|${language}`] ?? [],
        });
      }
    }
  }
  for (const [language, row] of Object.entries(unresolvedByLanguage)) {
    gaps.push({
      kind: 'imports-unresolved',
      scope: language,
      reason: `${row.count} import specifier(s) in ${language} named nothing inside the project (external package or broken path)`,
      count: row.count,
      samples: row.samples,
    });
  }

  gaps.sort(compareGaps);
  return { coverage, gaps };
}

/** Deterministic gap order: kind, then scope. */
export function compareGaps(a, b) {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.scope !== b.scope) return a.scope < b.scope ? -1 : 1;
  return 0;
}

/** Sort an object's own keys (locale-independent) so output bytes are stable. */
export function sortObjectKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    out[key] = obj[key];
  }
  return out;
}

/**
 * Per-language conservation check. Returns the languages that violate
 * `files = parsed + zeroSymbol + Σ skipped`, with both sides, so a caller can
 * fail loudly instead of publishing a ledger that does not add up.
 */
export function conservationViolations(coverage) {
  const violations = [];
  for (const [language, row] of Object.entries(coverage.byLanguage ?? {})) {
    const accounted =
      row.parsed + row.zeroSymbol + Object.values(row.skipped).reduce((a, b) => a + b, 0);
    if (accounted !== row.files) {
      violations.push({ language, files: row.files, accounted });
    }
  }
  return violations;
}

export { KIND_FIELDS };
