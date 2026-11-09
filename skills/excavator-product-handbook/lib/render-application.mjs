/**
 * The cells of one application row of the system facts (system-facts.mjs): the
 * applications table of handbook.md and the facts of an application in the
 * technical view are written from the same cells.
 */

import { fill } from './ui.mjs';

/** A table cell for a list: its items joined, or the dash when there is none. */
export const listCell = (items) => (items.length === 0 ? '-' : items.join(', '));

/** The header keys of the fact cells, in the order `applicationCells` gives them after the directory, name and responsibility. */
export const FACT_KEYS = Object.freeze(['md.table.languages', 'md.table.frameworks', 'md.table.files', 'md.table.lines', 'md.table.firstCommit', 'md.table.lastCommit', 'md.table.commits', 'md.table.authors']);

/** `[dir, name, does, ...facts]`: the name and responsibility are the fixed not-verified text when no verified application stands for the directory. */
export function applicationCells(application, t) {
  const history = application.history === null
    ? Array(4).fill(t('md.overview.noHistory'))
    : [application.history.first, application.history.last, String(application.history.commits), String(application.history.authors)];
  return [
    application.dir,
    application.name ?? t('md.overview.notVerified'),
    application.does ?? t('md.overview.notVerified'),
    listCell(application.languages.map((entry) => fill(t('md.overview.languageItem'), { language: entry.language, files: entry.files }))),
    listCell(application.frameworks.map((entry) => fill(t('md.overview.frameworkItem'), { framework: entry.framework, count: entry.candidates }))),
    String(application.files),
    String(application.lines),
    ...history,
  ];
}
