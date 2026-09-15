#!/usr/bin/env node
/**
 * session-start-freshness-check.mjs
 *
 * The SessionStart hook's freshness DECISION (openspec: changes/
 * full-semantic-isolation, capability `consumer-freshness`, design D5).
 * `hooks.json`'s SessionStart entry used to compute this itself, comparing
 * `meta.json`'s `gitCommitHash` against `git rev-parse HEAD` inline in a
 * shell one-liner. This script replaces that ad hoc comparison with the ONE
 * shared, deterministic `resolveFreshness` helper
 * (`skills/excavator/consumer-freshness.mjs`) — the same helper every
 * consumer skill now uses — so a git project's staleness notice is decided
 * by the SAME `sourceRevision` comparison everywhere, not a hook-local
 * re-derivation of it.
 *
 * This script owns only the DECISION: exit 0 means "the graph looks stale,
 * print the notice"; any other exit code means "stay silent". The notice
 * TEXT itself stays inline in `hooks.json` (so the existing "propose, never
 * auto-execute" wording review — see tests/hooks — still applies to the
 * actual shell command a user's hook config runs), chained with `&&`/`||` in
 * `hooks.json` exactly the way the previous inline comparison was.
 *
 * Exit codes:
 *   0  — autoUpdate is enabled, a knowledge graph exists, and
 *        resolveFreshness reports `stale`.
 *   1  — anything else (fresh, missing, autoUpdate disabled, no graph yet) —
 *        stay silent, never treat "missing" as "stale" (no manifest yet is
 *        not evidence of staleness).
 *
 * Never prints anything itself — the shell one-liner in hooks.json owns the
 * user-facing message text.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = '.excavator';

function autoUpdateEnabled(dataDir) {
  try {
    const config = JSON.parse(readFileSync(`${dataDir}/config.json`, 'utf8'));
    return config.autoUpdate === true;
  } catch {
    return false;
  }
}

async function main() {
  const projectRoot = resolve(process.cwd());
  const dataDir = `${projectRoot}/${DATA_DIR}`;

  if (!autoUpdateEnabled(dataDir)) process.exit(1);
  if (!existsSync(`${dataDir}/knowledge-graph.json`)) process.exit(1);

  // Resolved relative to THIS file's own location (a sibling of skills/ under
  // the plugin root) rather than via $CLAUDE_PLUGIN_ROOT, so this works the
  // same whether or not that env var is set for this invocation.
  const { resolveFreshness } = await import(
    new URL('../skills/excavator/consumer-freshness.mjs', import.meta.url).href
  );
  const result = await resolveFreshness(projectRoot);
  process.exit(result.status === 'stale' ? 0 : 1);
}

await main();
