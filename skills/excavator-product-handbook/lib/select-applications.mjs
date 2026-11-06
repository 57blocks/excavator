/**
 * `handbook.mjs select <out> --applications <list> --project <root>` (openspec
 * change handbook-system-findings, design D1): resolve the `--applications` list
 * of a run to system unit ids, the way select.mjs resolves `--features`. Each
 * item is one application root directory, exactly as `handbook.mjs applications`
 * prints it (after trimming white space); an item that is not a root stops the
 * run with every root listed. The units come out in the order of the roots, each
 * once. It reads the project's roots only and changes no file.
 */

import { scanProject } from './applications.mjs';
import { UsageError } from './errors.mjs';
import { SELECT_NEXT } from './select.mjs';
import { systemUnitId } from './system-shape.mjs';

/** The items of a comma-separated list, trimmed; an empty list or item is a usage error. */
export function parseApplicationList(list) {
  const items = String(list).split(',').map((item) => item.trim());
  if (items.some((item) => item === '')) throw new UsageError('--applications needs a comma-separated list of application root directories with no empty item (for example "backend" or "backend, web")');
  return items;
}

/** Returns { status, lines }: the unit ids of the chosen roots in root order, or every problem, every root as `app<n>  <dir>` and the stop line. */
export function selectApplications(root, list) {
  const items = parseApplicationList(list);
  const { roots } = scanProject(root);
  const problems = items.filter((item) => !roots.includes(item)).map((item) => `${JSON.stringify(item)}: is not an application root`);
  if (problems.length > 0) {
    return { status: 1, lines: [...problems, ...roots.map((dir, i) => `app${i + 1}  ${dir}`), SELECT_NEXT] };
  }
  return { status: 0, lines: roots.flatMap((dir, i) => (items.includes(dir) ? [systemUnitId(i + 1)] : [])) };
}
