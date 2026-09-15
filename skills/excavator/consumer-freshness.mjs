#!/usr/bin/env node
/**
 * consumer-freshness.mjs
 *
 * The ONE shared, deterministic freshness helper (openspec: changes/
 * full-semantic-isolation, capability `consumer-freshness`, design D5).
 * Every consumer of a persisted analysis product — `excavator-chat`,
 * `-diff`, `-explain`, `-onboard`, `-domain`, and the SessionStart
 * auto-update hook — used to compute its OWN staleness signal, each reading
 * `project.gitCommitHash` out of `knowledge-graph.json` and re-deriving a
 * `git diff`/`git rev-parse HEAD` comparison by hand. That is exactly the ad
 * hoc, per-consumer logic this module replaces: it is the ONE place that
 * decides "is the persisted analysis still current", by comparing the
 * CURRENT `sourceRevision` (resolved via `resolveSourceSnapshot`, never by a
 * consumer running its own `git` commands) against the `sourceRevision`
 * persisted in `source-manifest.json` (written by `lazy-analyze.mjs`/
 * `sync-fact-graph.mjs`, and — since Slice D's Phase F reuse — by Full mode
 * too).
 *
 * Reading the CURRENT revision only through `resolveSourceSnapshot` is what
 * gives every consumer, for free, the two guarantees the spec asks for:
 *   - a git target resolves through `GitCommitSnapshot`, which is HEAD-only
 *     by construction (see that module's own header) — staged, unstaged and
 *     untracked changes can never flip `fresh` to `stale` or vice versa;
 *   - a directory target resolves through `DirectorySnapshot`, whose
 *     `revision` is a hash over every tracked file's CONTENT — any content
 *     drift changes the revision, so a stale directory target is always
 *     caught (the content-hash guard).
 * This module adds no reading of its own on top of that: it never opens a
 * source file directly, only `source-manifest.json`.
 *
 * `resolveFreshness` NEVER throws — every failure mode (no manifest yet, a
 * corrupt manifest, a git repo with no commits, `@excavator/core` not
 * resolvable) becomes a `'missing'` status with a `reason` string, because a
 * freshness check that could throw would crash the very consumer trying to
 * degrade gracefully.
 *
 * Usage (CLI):
 *   node consumer-freshness.mjs <projectRoot>
 *     prints `{ status, currentSourceRevision, manifestSourceRevision, reason }`
 *     as JSON to stdout.
 *
 * Programmatic:
 *   import { resolveFreshness } from './consumer-freshness.mjs';
 *
 * Contract: openspec/changes/full-semantic-isolation/specs/consumer-freshness/spec.md
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

import { resolveSourceSnapshot } from './source-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

/** Same two-step @excavator/core resolution every sibling script uses. */
async function resolveCore(root) {
  const require = createRequire(resolve(root, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);
  }
}

/**
 * @param {string} projectRoot
 * @returns {Promise<{
 *   status: 'fresh'|'stale'|'missing',
 *   currentSourceRevision: string|null,
 *   manifestSourceRevision: string|null,
 *   reason: string,
 * }>}
 */
export async function resolveFreshness(projectRoot) {
  const root = resolve(projectRoot);

  let currentSourceRevision;
  try {
    currentSourceRevision = resolveSourceSnapshot(root).revision;
  } catch (err) {
    return {
      status: 'missing',
      currentSourceRevision: null,
      manifestSourceRevision: null,
      reason: `could not resolve the current source snapshot: ${err.message}`,
    };
  }

  let core;
  try {
    core = await resolveCore(pluginRoot);
  } catch (err) {
    return {
      status: 'missing',
      currentSourceRevision,
      manifestSourceRevision: null,
      reason: `could not resolve @excavator/core: ${err.message}`,
    };
  }

  const dataDir = core.resolveDataDir(root);
  const manifestPath = join(dataDir, 'source-manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      status: 'missing',
      currentSourceRevision,
      manifestSourceRevision: null,
      reason: 'no persisted source-manifest.json — run /excavator first',
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    return {
      status: 'missing',
      currentSourceRevision,
      manifestSourceRevision: null,
      reason: `source-manifest.json is not valid JSON: ${err.message}`,
    };
  }

  const manifestSourceRevision = typeof manifest?.sourceRevision === 'string' && manifest.sourceRevision.length > 0
    ? manifest.sourceRevision
    : null;
  if (!manifestSourceRevision) {
    return {
      status: 'missing',
      currentSourceRevision,
      manifestSourceRevision: null,
      reason: 'persisted source-manifest.json has no sourceRevision',
    };
  }

  if (currentSourceRevision === manifestSourceRevision) {
    return {
      status: 'fresh',
      currentSourceRevision,
      manifestSourceRevision,
      reason: 'current sourceRevision matches the persisted source-manifest.json',
    };
  }
  return {
    status: 'stale',
    currentSourceRevision,
    manifestSourceRevision,
    reason: 'current sourceRevision differs from the persisted source-manifest.json',
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const [projectRoot] = process.argv.slice(2);
  if (!projectRoot) {
    process.stderr.write('Usage: node consumer-freshness.mjs <projectRoot>\n');
    process.exit(1);
  }
  const result = await resolveFreshness(projectRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stderr.write(`consumer-freshness: ${result.status} (${result.reason})\n`);
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`consumer-freshness.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { resolveFreshness };
