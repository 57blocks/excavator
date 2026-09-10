#!/usr/bin/env node
/**
 * extract-structure.mjs
 *
 * Deterministic structural extraction script for the file-analyzer agent.
 * Uses PluginRegistry (TreeSitterPlugin + non-code parsers) from @excavator/core
 * to replace the LLM-generated throwaway regex scripts in Phase 1.
 *
 * Usage:
 *   node extract-structure.mjs <input.json> <output.json>
 *
 * Input JSON:
 *   { projectRoot, batchFiles: [{path, language, sizeLines, fileCategory}], batchImportData }
 *
 * Output JSON:
 *   { scriptCompleted, filesAnalyzed, filesSkipped, analysisOutcomes,
 *     byStatus: { parsed, zero-symbol, no-extractor, parse-failed },
 *     results: [{ path, language, status, statusReason?, ... }] }
 *
 * Every input file gets exactly one `results` row carrying a `status` of
 * parsed | zero-symbol | no-extractor | parse-failed. Failed and
 * extractor-less files are NOT dropped from `results`.
 */

import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import {
  analyzeFileWithOutcomes,
  buildResult as buildExtractResult,
} from './extract-structure-result.mjs';

export {
  analyzeFileWithOutcomes,
  buildResult,
  deriveStatus,
  EXTRACTION_OUTCOMES,
} from './extract-structure-result.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/excavator/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @excavator/core
//
// Node ESM dynamic import() requires a file:// URL on Windows; passing a raw
// absolute path like "C:\..." throws ERR_UNSUPPORTED_ESM_URL_SCHEME because the
// loader parses "C:" as a URL scheme. Wrap both resolutions in pathToFileURL().
// ---------------------------------------------------------------------------
let core;
try {
  core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
} catch {
  // Fallback: direct path for installed plugin cache layouts
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { TreeSitterPlugin, PluginRegistry, builtinLanguageConfigs, registerAllParsers } = core;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: node extract-structure.mjs <input.json> <output.json>\n');
    process.exit(1);
  }

  // Read input
  const inputRaw = readFileSync(inputPath, 'utf-8');
  const input = JSON.parse(inputRaw);
  const { projectRoot, batchFiles, batchImportData } = input;

  if (!projectRoot || !Array.isArray(batchFiles)) {
    throw new Error('Invalid input: must contain projectRoot and batchFiles array');
  }

  // Create tree-sitter plugin with all configs that have WASM grammars
  const tsConfigs = builtinLanguageConfigs.filter(c => c.treeSitter);
  const tsPlugin = new TreeSitterPlugin(tsConfigs);
  await tsPlugin.init();

  // Create registry and register tree-sitter + all non-code parsers
  const registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);

  const results = [];
  const filesSkipped = [];
  // Every `results` row is counted here, so
  // structure.succeeded + structure.failed + structure.skipped === results.length
  // and the same identity holds for callGraph. `skipped` = structure was never
  // attempted (no extractor for the language, or the file could not be read at
  // all); `failed` = a reader ran and did not produce usable structure. The
  // per-file `status`/`statusReason` in `results` keeps the finer distinction.
  const analysisOutcomes = {
    structure: { succeeded: 0, failed: 0, skipped: 0 },
    callGraph: { succeeded: 0, failed: 0, skipped: 0 },
  };

  for (const file of batchFiles) {
    const absolutePath = join(projectRoot, file.path);

    // Read file content. A file that cannot be read here is still reported —
    // dropping it would leave an input in no bucket at all.
    let content;
    try {
      content = readFileSync(absolutePath, 'utf-8');
    } catch {
      filesSkipped.push(file.path);
      results.push(buildExtractResult(file, 0, 0, null, null, batchImportData, 'read-failed'));
      analysisOutcomes.structure.skipped += 1;
      analysisOutcomes.callGraph.skipped += 1;
      continue;
    }

    // Line counts. POSIX text files end in a trailing newline, which makes
    // `split('\n')` produce one extra empty element. Match `wc -l` semantics
    // (used by the project scanner for `sizeLines`) so the two counts agree.
    const lines = content.split('\n');
    const totalLines = content.endsWith('\n') ? Math.max(0, lines.length - 1) : lines.length;
    const nonEmptyLines = lines.filter(l => l.trim().length > 0).length;

    const { analysis, callGraph, structureOutcome, callGraphOutcome } =
      analyzeFileWithOutcomes(registry, file, content);

    if (structureOutcome === 'skipped') {
      // No extractor for this language. The file stays in `results` with
      // status `no-extractor` so the coverage ledger can name it; it also
      // stays in `filesSkipped` for the existing consumers of that list.
      filesSkipped.push(file.path);
      results.push(
        buildExtractResult(file, totalLines, nonEmptyLines, null, null, batchImportData, 'skipped'),
      );
      analysisOutcomes.structure.skipped += 1;
      analysisOutcomes.callGraph.skipped += 1;
      continue;
    }

    analysisOutcomes.structure[structureOutcome] += 1;
    analysisOutcomes.callGraph[callGraphOutcome] += 1;

    // Build result object. A parse failure keeps its row (status
    // `parse-failed`) instead of vanishing from the output.
    const result = buildExtractResult(
      file, totalLines, nonEmptyLines, analysis, callGraph, batchImportData, structureOutcome,
    );
    results.push(result);
  }

  // Per-status counts, so a consumer does not have to re-derive the ledger.
  const byStatus = {};
  for (const result of results) {
    byStatus[result.status] = (byStatus[result.status] || 0) + 1;
  }

  // Write output
  const output = {
    scriptCompleted: true,
    filesAnalyzed: results.length,
    filesSkipped,
    analysisOutcomes,
    byStatus,
    results,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  if (!existsSync(outputPath)) {
    throw new Error(`output file missing after write: ${outputPath}`);
  }
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
    process.stderr.write(`extract-structure.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}
