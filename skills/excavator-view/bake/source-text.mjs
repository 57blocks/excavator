/**
 * source-text.mjs
 *
 * Embeds source text for the page (openspec change `artifact-view`,
 * requirement "source embedding is optional", design D4): the text of each
 * evidence line and the source excerpt of each node with a `lineRange`.
 *
 * Source is read only through SourceSnapshot, never from the working tree
 * directly. For a git target whose manifest names `git:<sha>`, the snapshot
 * is pinned to that sha, so a moved HEAD still yields exactly the analyzed
 * content. Other targets read the current snapshot. The snapshot is
 * materialized once (git content arrives through batched `git cat-file`,
 * not one `git show` per file) and removed afterwards. Either way each file's
 * bytes are hashed and compared with the manifest's `contentHash`; a file
 * that differs is not embedded and is counted, as is a file the graph cites
 * that is not in the manifest at all, or one that cannot be read. Only the
 * needed lines are kept.
 *
 * Source text lives in its own string tables (`evidenceText.strings`,
 * `excerpts.strings`), not in the global table, so the budget can drop
 * either one whole without leaving its bytes behind.
 */

import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { CELL_ABSENT, table } from '../bundle-codec.mjs';
import { TextTable } from './text-table.mjs';
import { resolveSourceSnapshot, GitCommitSnapshot, isGitRepoRoot, contentHash } from '../../excavator/source-snapshot.mjs';

/**
 * @param {string} projectRoot
 * @param {string|null} sourceRevision
 */
function openSnapshot(projectRoot, sourceRevision) {
  if (typeof sourceRevision === 'string' && sourceRevision.startsWith('git:') && isGitRepoRoot(projectRoot)) {
    try {
      return { snapshot: new GitCommitSnapshot(projectRoot, sourceRevision.slice('git:'.length)), pinned: true };
    } catch {
      // The manifest's commit is not available locally; fall through to the
      // current snapshot. Per-file hash checks still keep mismatches out.
    }
  }
  return { snapshot: resolveSourceSnapshot(projectRoot), pinned: false };
}

/**
 * @param {{
 *   projectRoot: string,
 *   manifest: { sourceRevision?: string, entries: Array<{ path: string, contentHash: string }> },
 *   strings: string[],
 *   nodes: { rows: number, columns: Record<string, Int32Array> },
 *   evidence: { rows: number, columns: Record<string, Int32Array> },
 * }} args
 */
export function collectSourceText({ projectRoot, manifest, strings, nodes, evidence }) {
  const manifestHash = new Map(manifest.entries.map((e) => [e.path, e.contentHash]));

  /** @type {Map<number, { evidenceRows: number[], nodeRows: number[] }>} */
  const byFile = new Map();
  const want = (/** @type {number} */ fileCell) => {
    let entry = byFile.get(fileCell);
    if (!entry) {
      entry = { evidenceRows: [], nodeRows: [] };
      byFile.set(fileCell, entry);
    }
    return entry;
  };
  const { file: evFile, line: evLine } = evidence.columns;
  for (let row = 0; row < evidence.rows; row += 1) {
    if (evFile[row] >= 0 && evLine[row] >= 1) want(evFile[row]).evidenceRows.push(row);
  }
  const { path: nodePath, line0, line1 } = nodes.columns;
  for (let row = 0; row < nodes.rows; row += 1) {
    if (nodePath[row] >= 0 && line0[row] >= 1 && line1[row] >= line0[row]) want(nodePath[row]).nodeRows.push(row);
  }

  const evidenceText = new Int32Array(evidence.rows).fill(CELL_ABSENT);
  const excerpts = new Int32Array(nodes.rows).fill(CELL_ABSENT);
  const evidenceStrings = new TextTable();
  const excerptStrings = new TextTable();
  const stats = {
    snapshotPinned: false,
    filesCited: byFile.size,
    filesEmbedded: 0,
    filesHashMismatch: 0,
    filesNotInManifest: 0,
    filesUnreadable: 0,
    linesOutOfRange: 0,
    hashMismatchSamples: /** @type {string[]} */ ([]),
  };
  if (byFile.size === 0) {
    return finish();
  }

  const { snapshot, pinned } = openSnapshot(projectRoot, manifest.sourceRevision ?? null);
  stats.snapshotPinned = pinned;
  const materialized = snapshot.materialize();
  try {
    readCitedFiles(materialized);
  } finally {
    materialized.cleanup();
  }
  return finish();

  /** @param {{ dir: string, driftedPaths?: string[] }} materialized */
  function readCitedFiles(materialized) {
    const root = resolve(materialized.dir);
    const drifted = new Set(materialized.driftedPaths ?? []);
    for (const [fileCell, rows] of byFile) {
      const path = strings[fileCell];
      const expected = manifestHash.get(path);
      if (expected === undefined) {
        stats.filesNotInManifest += 1;
        continue;
      }
      if (drifted.has(path)) {
        // The snapshot itself saw the content change since it was resolved.
        stats.filesHashMismatch += 1;
        if (stats.hashMismatchSamples.length < 20) stats.hashMismatchSamples.push(path);
        continue;
      }
      // Paths come from artifact data: never read outside the materialization.
      const absolute = resolve(root, path);
      if (!absolute.startsWith(root + sep)) {
        stats.filesUnreadable += 1;
        continue;
      }
      let buf;
      try {
        buf = readFileSync(absolute);
      } catch {
        stats.filesUnreadable += 1;
        continue;
      }
      if (contentHash(buf) !== expected) {
        stats.filesHashMismatch += 1;
        if (stats.hashMismatchSamples.length < 20) stats.hashMismatchSamples.push(path);
        continue;
      }
      stats.filesEmbedded += 1;
      const lines = buf.toString('utf-8').split(/\r?\n/);
      for (const row of rows.evidenceRows) {
        const index = evLine[row] - 1;
        if (index < lines.length) evidenceText[row] = evidenceStrings.id(lines[index]);
        else stats.linesOutOfRange += 1;
      }
      for (const row of rows.nodeRows) {
        if (line1[row] <= lines.length) excerpts[row] = excerptStrings.id(lines.slice(line0[row] - 1, line1[row]).join('\n'));
        else stats.linesOutOfRange += 1;
      }
    }
  }

  function finish() {
    return {
      stats,
      evidenceText: {
        bytes: evidenceStrings.bytes,
        segments: {
          'evidenceText.strings': evidenceStrings.strings,
          evidenceText: table(evidence.rows, { text: evidenceText }),
        },
      },
      excerpts: {
        bytes: excerptStrings.bytes,
        segments: {
          'excerpts.strings': excerptStrings.strings,
          excerpts: table(nodes.rows, { text: excerpts }),
        },
      },
    };
  }
}
