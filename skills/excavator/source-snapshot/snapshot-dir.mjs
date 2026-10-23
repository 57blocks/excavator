/**
 * snapshot-dir.mjs
 *
 * The one place that names the temporary directories a snapshot materializes
 * into (openspec: changes/viewer-explorer, design D4d). Analysis reads its
 * source from such a directory, so anything derived from "the directory being
 * read" (a project name taken from the folder) names the snapshot, not the
 * project; `isSnapshotDirName` lets the callers that name the project tell the
 * two apart.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The snapshot kinds that materialize into a temporary directory. */
export const SNAPSHOT_DIR_KINDS = Object.freeze(['dir', 'git', 'multi']);

const SNAPSHOT_DIR_NAME = new RegExp(`^excavator-snapshot-(?:${SNAPSHOT_DIR_KINDS.join('|')})-[A-Za-z0-9]{6}$`);

/** A new empty temporary directory for one `kind` of snapshot. */
export function makeSnapshotDir(kind) {
  if (!SNAPSHOT_DIR_KINDS.includes(kind)) throw new Error(`makeSnapshotDir: unknown snapshot kind ${kind}`);
  return mkdtempSync(join(tmpdir(), `excavator-snapshot-${kind}-`));
}

/** True when `name` is the name `makeSnapshotDir` gives a directory. */
export function isSnapshotDirName(name) {
  return typeof name === 'string' && SNAPSHOT_DIR_NAME.test(name);
}
