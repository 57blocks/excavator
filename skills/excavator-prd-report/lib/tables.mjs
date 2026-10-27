/**
 * The Markdown tables of a PRD run, written by `aggregate` and inserted by
 * `assemble` (openspec changes prd-feature-pipeline, design D7, and
 * prd-report-prd-shape, design D4): the model never transcribes them.
 * Deterministic: rows follow the index order, or chapter order where they
 * are listed for the written features.
 */

import { VERIFICATION_KEYS } from './index-check.mjs';

const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;
const header = (cells) => [row(cells), `|${cells.map(() => '---').join('|')}|`];
const label = (feature) => `${feature.id} ${feature.name}`;

/** The glossary, in the order of index.json: `| Term | Meaning |`, or `None.`. */
export function terminologyTable(glossary) {
  if (glossary.length === 0) return 'None.\n';
  return `${[...header(['Term', 'Meaning']), ...glossary.map((entry) => row([entry.term, entry.meaning]))].join('\n')}\n`;
}

/** The distinct `items` in the order they first appear. */
const firstSeen = (items) => [...new Set(items)];

/**
 * The actors and permission roles the written chapters declare, in document
 * order (`written` is in chapter order; `chaptersById` holds each one's
 * split). Actors by feature has a row for every written feature and a column
 * for every actor of the index (`indexActors`, in its order) that at least
 * one written feature uses (change prd-report-prd-shape, design D12);
 * Permission roles has a row for every role, in order of first appearance,
 * with the features that name it.
 */
export function rolesTable(written, chaptersById, indexActors) {
  const of = (feature, key) => chaptersById.get(feature.id)?.[key] ?? [];
  const lines = ['### Actors by feature', ''];
  const used = new Set(written.flatMap((feature) => of(feature, 'actors')));
  const actors = indexActors.filter((actor) => used.has(actor));
  if (actors.length === 0) {
    lines.push('No written feature lists an actor.');
  } else {
    lines.push(...header(['Feature', ...actors]));
    for (const feature of written) {
      const own = new Set(of(feature, 'actors'));
      lines.push(row([label(feature), ...actors.map((actor) => (own.has(actor) ? 'x' : ''))]));
    }
  }
  lines.push('', '### Permission roles', '');
  const roles = firstSeen(written.flatMap((feature) => of(feature, 'permissionRoles')));
  if (roles.length === 0) {
    lines.push('No written feature lists a permission role.');
  } else {
    lines.push(...header(['Role', 'Features']));
    for (const role of roles) {
      lines.push(row([role, written.filter((feature) => of(feature, 'permissionRoles').includes(role)).map(label).join(', ')]));
    }
  }
  return `${lines.join('\n')}\n`;
}

/** `text` with each `|` that a backslash does not escape escaped; an item written as a list can hold one. */
function escapeBarePipes(text) {
  let out = '';
  for (let k = 0; k < text.length; k += 1) {
    if (text[k] === '\\' && k + 1 < text.length) {
      out += text[k] + text[k + 1];
      k += 1;
    } else {
      out += text[k] === '|' ? '\\|' : text[k];
    }
  }
  return out;
}

/**
 * The open items table (change prd-report-dedupe, design D5): one row for each
 * of `rows` (`{ item, known, searched, features }`, see `mergedRows`), numbered
 * from 1, the features as ids; `None.` when there are none. The cells are the
 * text of the chapters as extracted, not escaped again.
 */
export function openItemsTable(rows) {
  if (rows.length === 0) return 'None.\n';
  const lines = [...header(['#', 'Item', 'What is known', 'What was searched', 'Features'])];
  rows.forEach((entry, at) => {
    const cells = [at + 1, entry.item, entry.known, entry.searched, entry.features.join(', ')];
    lines.push(`| ${cells.map((value) => escapeBarePipes(String(value))).join(' | ')} |`);
  });
  return `${lines.join('\n')}\n`;
}

/**
 * Every candidate, the feature it belongs to and that feature's status;
 * `outsideLine` is the line about seed files outside the scope, or null;
 * `openItemsLine` is the line about the open items and their merge (change
 * prd-report-dedupe, design D5), placed after it.
 */
export function coverageTable(index, outsideLine, openItemsLine) {
  const owner = new Map();
  for (const feature of index.features) for (const id of feature.entrypoints) owner.set(id, feature);
  const { candidates, assigned, unassigned } = index.conservation;
  const lines = ['### Coverage', '', `${candidates} candidates: ${assigned} in a feature, ${unassigned} unassigned.`];
  if (index.candidates.uncovered.length > 0) {
    lines.push(`Frameworks with no entrypoint patterns: ${index.candidates.uncovered.join(', ')}.`);
  }
  if (outsideLine !== null) lines.push(outsideLine);
  lines.push(openItemsLine);
  lines.push('', ...header(['Candidate', 'Kind', 'Location', 'Framework', 'Feature', 'Status']));
  for (const item of index.candidates.items) {
    const feature = owner.get(item.id);
    lines.push(row([
      item.id,
      item.kind,
      `\`${item.file}:${item.line}\``,
      item.provenance === 'inferred' ? `${item.framework} (inferred)` : item.framework,
      feature ? label(feature) : 'unassigned',
      feature ? feature.status : '-',
    ]));
  }
  return `${lines.join('\n')}\n`;
}

/** The verification counts of each feature, and their sum over the verified ones. */
export function verificationTable(features, totals) {
  const lines = ['### Verification', ''];
  lines.push(...header(['Feature', 'Status', 'Verified', 'Contradicted', 'Misattributed', 'Unverifiable', 'Resolved right', 'Resolved wrong', 'Still open', 'Conflicts', 'Not checked']));
  for (const feature of features) {
    const counts = feature.counts.verification;
    lines.push(row([label(feature), feature.status, ...VERIFICATION_KEYS.map((key) => (counts ? counts[key] : '-'))]));
  }
  lines.push(row(['Total', '', ...VERIFICATION_KEYS.map((key) => totals[key])]));
  return `${lines.join('\n')}\n`;
}
