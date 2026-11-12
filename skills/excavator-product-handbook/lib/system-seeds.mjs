/**
 * The application of a system findings unit and its seed files (openspec change
 * handbook-system-findings, design D3). An application is the n-th root that
 * `handbook.mjs applications` prints. A seed file is a file under that root that
 * holds a `main` or a `job` candidate (the start-up and the scheduled work, which
 * no feature owns) or at least `SEED_MIN_CANDIDATES` candidates of any kind (a
 * route table, a page index: the shared place where many things are registered).
 * The threshold is not tuned: a file below it that matters is read only when the
 * subagent follows a call into it.
 */

import { UsageError } from './errors.mjs';
import { scanProject } from './applications.mjs';
import { applicationNumber } from './system-shape.mjs';

export const SEED_MIN_CANDIDATES = 5;
const SEED_KINDS = Object.freeze(['main', 'job']);

/** Whether the project-relative file `rel` is the application root `appDir` or lies below it (the project root `.` holds every file). */
export const underApplication = (rel, appDir) => appDir === '.' || rel.startsWith(`${appDir}/`);

/** The sorted seed files of the application at `appDir` among the candidates `items` (candidates.json's items). */
export function seedFilesOf(items, appDir) {
  const counts = new Map();
  const seeds = new Set();
  for (const item of items) {
    if (!underApplication(item.file, appDir)) continue;
    counts.set(item.file, (counts.get(item.file) ?? 0) + 1);
    if (SEED_KINDS.includes(item.kind)) seeds.add(item.file);
  }
  for (const [file, count] of counts) if (count >= SEED_MIN_CANDIDATES) seeds.add(file);
  return [...seeds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The application root directories of the project and the one of unit `id`.
 * A number past the last root is a usage error naming the roots.
 */
export function applicationOf(projectRoot, id) {
  const { roots } = scanProject(projectRoot);
  const n = applicationNumber(id);
  if (n > roots.length) {
    throw new UsageError(`${id}: the project has ${roots.length} application root${roots.length === 1 ? '' : 's'}${roots.length > 0 ? ` (${roots.join(', ')})` : ''}; there is no application ${n}`);
  }
  return { roots, appDir: roots[n - 1] };
}
