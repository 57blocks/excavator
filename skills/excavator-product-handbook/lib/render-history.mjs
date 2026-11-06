/**
 * The Code health chapter of handbook.md (openspec change
 * handbook-history-appendix, design D4), written from the model of
 * history-model.mjs. Every fixed text is a ui key; the numbers and the names are
 * the script's. The product view shows a file by its name and the application it
 * is in, never a path; the technical view shows the path. Nothing here evaluates
 * a number or advises on it. Pure and deterministic.
 */

import { inline, table } from './markdown.mjs';
import { fill } from './ui.mjs';

const DASH = '-';
const camel = (text) => text.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** The ui key of a reason a history is missing (`not-a-repository` is `notARepository`). */
export const reasonKey = (reason) => `md.history.reason.${camel(reason)}`;

const label = (text) => inline(text).replace(/"/g, "'");

/** The bar chart of the commits of each year, drawn from the rows of the table above it. */
export function yearsChart(years, t) {
  const top = Math.max(1, ...years.map((row) => row.commits));
  return [
    '```mermaid',
    'xychart-beta',
    `  title "${label(t('md.history.chartTitle'))}"`,
    `  x-axis [${years.map((row) => row.year).join(', ')}]`,
    `  y-axis "${label(t('md.history.chartAxis'))}" 0 --> ${top}`,
    `  bar [${years.map((row) => row.commits).join(', ')}]`,
    '```',
  ];
}

function yearsBlock(history, t) {
  const out = [`### ${t('md.history.yearsHeading')}`, '', t('md.history.yearsNote'), ''];
  if (history.years.length === 0) return [...out, t('md.none'), ''];
  const rows = history.years.map((row) => [
    String(row.year),
    String(row.commits),
    Object.keys(row.byApp).length === 0 ? DASH : Object.entries(row.byApp).map(([application, count]) => inline(fill(t('md.history.byAppItem'), { application, count }))).join('<br>'),
  ]);
  out.push(table([t('md.history.table.year'), t('md.table.commits'), t('md.history.table.byApplication')], rows), '');
  out.push(t('md.history.chartNote'), '', ...yearsChart(history.years, t), '');
  return out;
}

function appsBlock(history, t) {
  const out = [`### ${t('md.history.appsHeading')}`, '', t('md.history.appsNote'), ''];
  if (history.apps.length === 0) return [...out, t('md.none'), ''];
  const rows = history.apps.map((row) => (row.commits === null
    ? [row.dir, fill(t('md.history.appNoHistory'), { reason: t(reasonKey(row.reason)) }), DASH, DASH, DASH, DASH]
    : [row.dir, row.first, row.last, String(row.commits), String(row.authors), String(row.authors80)]));
  out.push(table([t('md.table.directory'), t('md.table.firstCommit'), t('md.table.lastCommit'), t('md.table.commits'), t('md.table.authors'), t('md.history.table.authorsEighty')], rows), '');
  return out;
}

function hotspotsBlock(history, map, technical, t) {
  const out = [`### ${t('md.history.hotspotsHeading')}`, '', t('md.history.hotspotsNote'), ''];
  if (history.hotspots.length === 0) return [...out, t('md.none'), ''];
  const names = new Map(map.features.map((feature) => [feature.id, feature.name]));
  const rows = history.hotspots.map((row) => [
    technical ? row.path : row.name,
    row.app ?? DASH,
    String(row.commits),
    String(row.authors),
    String(row.lines),
    row.last,
    row.features.length === 0 ? DASH : row.features.map((id) => inline(names.get(id) ?? id)).join(', '),
  ]);
  out.push(table([t(technical ? 'md.history.table.path' : 'md.history.table.file'), t('md.table.application'), t('md.table.commits'), t('md.table.authors'), t('md.table.lines'), t('md.history.table.lastChange'), t('md.table.features')], rows), '');
  return out;
}

function coChangeBlock(history, technical, t) {
  const out = [`### ${t('md.history.coChangeHeading')}`, '', t('md.history.coChangeNote'), ''];
  if (history.coChange.length === 0) return [...out, t('md.none'), ''];
  const file = (path, name, application) => fill(t('md.history.fileInApplication'), { file: technical ? path : name, application: application ?? DASH });
  const rows = history.coChange.map((row) => [file(row.a, row.aName, row.appA), file(row.b, row.bName, row.appB), String(row.commits)]);
  out.push(table([t('md.history.table.firstFile'), t('md.history.table.secondFile'), t('md.history.table.together')], rows), '');
  return out;
}

function testsBlock(history, t) {
  const conventions = history.conventions.map((id) => t(`md.history.test.${id}`)).join('; ');
  const out = [`### ${t('md.history.testsHeading')}`, '', fill(t('md.history.testsNote'), { conventions }), ''];
  if (history.tests.length === 0) return [...out, t('md.none'), ''];
  out.push(table([t('md.table.directory'), t('md.table.files'), t('md.history.table.testFiles')], history.tests.map((row) => [row.dir, String(row.sourceFiles), String(row.testFiles)])), '');
  return out;
}

/** The Code health chapter: the heading and one line when the file is missing or malformed; the project's missing history with its reason and the test counts when it has none. */
export function historyChapter({ history, map, view, t }) {
  const out = [`## ${t('md.history.heading')}`, ''];
  if (history.state === 'missing') return [...out, t('md.history.notWritten'), ''];
  if (history.state === 'malformed') return [...out, t('md.history.malformed'), ''];
  out.push(t('md.history.note'), '');
  if (history.noHistory !== null) {
    out.push(fill(t('md.history.noHistory'), { reason: t(reasonKey(history.noHistory.reason)) }), '');
  } else {
    out.push(...yearsBlock(history, t), ...appsBlock(history, t), ...hotspotsBlock(history, map, view === 'technical', t), ...coChangeBlock(history, view === 'technical', t));
  }
  out.push(...testsBlock(history, t));
  return out;
}
