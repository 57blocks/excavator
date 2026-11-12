/**
 * The facts a remedies lane may cite (openspec change handbook-remedies, design
 * D2): one row for each group of the verified findings, one for each
 * application, one for the tables that two or more applications mention and one
 * for the counts. Built by a script from the checked run, never by a model, and
 * printed by `handbook.mjs remedy-facts` one line a row, tab-separated, the
 * first field the id a paragraph cites:
 *
 *   <group key> <level: P0|P1|P2|unranked> <category key> <representative statement>
 *   app:<dir> <name> <main language|-> <files> <lines> <commits|-> <authors|->
 *   tables-shared <count|-> <table (application, application)>...
 *   counts groups=<n> P0=<n> P1=<n> P2=<n> unranked=<n> <category key>=<n>...
 *
 * The digest of the lines is the input of the unit: a changed fact starts the
 * unit over, and the outputs ignore a remedies file written for other facts.
 * `buildFactRows` is pure; `loadRemedyFacts` builds the rows from a loaded run.
 */

import { createHash } from 'node:crypto';

import { NO_APPLICATION } from './data-files.mjs';
import { scanProject } from './applications.mjs';
import { loadDataSection } from './data-section.mjs';
import { buildFindings } from './findings-model.mjs';
import { FINDING_CATEGORIES } from './findings-shape.mjs';
import { withPriority } from './priority-model.mjs';
import { groupKey } from './priority-groups.mjs';
import { LEVELS } from './priority-shape.mjs';
import { buildSystem } from './system-facts.mjs';

export const NONE = '-';
export const UNRANKED = 'unranked';
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

/** The line a row prints. */
export const factLine = (row) => [row.id, ...row.fields].join('\t');

/**
 * The rows, in the order printed. `groups` are the groups of the verified findings with their `key`, `category`, `items` and
 * `priority` (priority-model.mjs); `applications` the application rows of the system facts; `data` the data section
 * (`{ state, data }`, data-section.mjs).
 */
export function buildFactRows({ groups, applications, data }) {
  const rows = groups.map((group) => ({
    id: group.key,
    kind: 'group',
    key: group.key,
    level: group.priority === null ? UNRANKED : group.priority.level,
    category: group.category,
    statement: oneLine(group.items[0].text),
    items: group.items,
    fields: [group.priority === null ? UNRANKED : group.priority.level, group.category, oneLine(group.items[0].text)],
  }));
  const nameOf = (dir) => applications.find((row) => row.dir === dir)?.name ?? dir;
  for (const application of applications) {
    const language = application.languages[0]?.language ?? NONE;
    const commits = application.history === null ? NONE : String(application.history.commits);
    const authors = application.history === null ? NONE : String(application.history.authors);
    rows.push({
      id: `app:${application.dir}`,
      kind: 'app',
      dir: application.dir,
      name: oneLine(nameOf(application.dir)),
      language,
      files: application.files,
      lines: application.lines,
      commits,
      authors,
      fields: [oneLine(nameOf(application.dir)), language, String(application.files), String(application.lines), commits, authors],
    });
  }
  // A table counts when two or more applications mention it; a mention outside every application root is no application's.
  const shared = data.state === 'ok'
    ? [...data.data.tables]
      .map((table) => ({ name: table.name, apps: Object.keys(table.mentions).filter((dir) => dir !== NO_APPLICATION).map(nameOf).sort(compare) }))
      .filter((table) => table.apps.length >= 2)
      .sort((a, b) => compare(a.name, b.name))
    : null;
  rows.push({
    id: 'tables-shared',
    kind: 'tables',
    count: shared === null ? null : shared.length,
    tables: shared ?? [],
    fields: shared === null ? [NONE] : [String(shared.length), ...shared.map((table) => `${oneLine(table.name)} (${table.apps.map(oneLine).join(', ')})`)],
  });
  const levels = Object.fromEntries([...LEVELS, UNRANKED].map((level) => [level, groups.filter((group) => (group.priority === null ? UNRANKED : group.priority.level) === level).length]));
  const categories = FINDING_CATEGORIES.map((category) => ({ category, count: groups.filter((group) => group.category === category).length })).filter((entry) => entry.count > 0);
  rows.push({
    id: 'counts',
    kind: 'counts',
    groups: groups.length,
    levels,
    categories,
    fields: [`groups=${groups.length}`, ...[...LEVELS, UNRANKED].map((level) => `${level}=${levels[level]}`), ...categories.map((entry) => `${entry.category}=${entry.count}`)],
  });
  return rows;
}

/** The digest of the whole set of fact lines: the input of the unit, kept in state.json. */
export const factsDigest = (rows) => createHash('sha256').update(rows.map(factLine).join('\n')).digest('hex');

/**
 * The facts of a loaded run (`loadCheckedRun`): `{ rows, byId, digest, groups, findings, applications }`. `groups` are the groups
 * of the verified findings as the handbook writes them (each with its key and priority), `findings` the model they came from.
 */
export function loadRemedyFacts(run, root) {
  const scan = scanProject(root);
  const system = buildSystem(run, root, scan);
  const findings = withPriority(buildFindings(run, root, { technical: false, roots: scan.roots, applicationRows: system.applications }), run.priority);
  return factsOf({ findings, applications: system.applications, data: loadDataSection(run.outDir) });
}

/** The facts from a findings model that has its priority (priority-model.mjs), the application rows and the data section. */
export function factsOf({ findings, applications, data }) {
  const groups = findings.groups.map((group) => ({ ...group, key: group.key ?? groupKey(group) }));
  const rows = buildFactRows({ groups, applications, data });
  return { rows, byId: new Map(rows.map((row) => [row.id, row])), digest: factsDigest(rows), groups, findings, applications };
}
