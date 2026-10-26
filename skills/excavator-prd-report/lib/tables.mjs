/**
 * The Markdown tables of a PRD run, written by `aggregate` and inserted by
 * `assemble` (openspec change prd-feature-pipeline, design D7): the model
 * never transcribes them. Deterministic: rows follow the index order.
 */

import { VERIFICATION_KEYS } from './index-check.mjs';

const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;
const header = (cells) => [row(cells), `|${cells.map(() => '---').join('|')}|`];
const label = (feature) => `${feature.id} ${feature.name}`;
const WRITTEN = new Set(['checked', 'verified']);

/** Roles by feature, from the front-matter `actors` of each written chapter. */
export function rolesTable(features, rolesById) {
  const written = features.filter((feature) => WRITTEN.has(feature.status));
  const roles = [...new Set(written.flatMap((feature) => rolesById.get(feature.id) ?? []))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lines = ['## Roles by feature', ''];
  if (written.length === 0 || roles.length === 0) {
    lines.push('No written feature lists a role.');
  } else {
    lines.push(...header(['Feature', ...roles]));
    for (const feature of written) {
      const own = new Set(rolesById.get(feature.id) ?? []);
      lines.push(row([label(feature), ...roles.map((role) => (own.has(role) ? 'x' : ''))]));
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Every candidate, the feature it belongs to and that feature's status. */
export function coverageTable(index) {
  const owner = new Map();
  for (const feature of index.features) for (const id of feature.entrypoints) owner.set(id, feature);
  const { candidates, assigned, unassigned } = index.conservation;
  const lines = ['### Coverage', '', `${candidates} candidates: ${assigned} in a feature, ${unassigned} unassigned.`];
  if (index.candidates.uncovered.length > 0) {
    lines.push(`Frameworks with no entrypoint patterns: ${index.candidates.uncovered.join(', ')}.`);
  }
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
