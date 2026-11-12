/**
 * check-domains (openspec change handbook-map-by-domain, design D2): the
 * domains file against the checked map. Shape, the language of the run,
 * ids that run D1, D2, ... without a gap, no empty domain, every map feature
 * in exactly one domain, then the citation, label, number, banned-words and
 * narrative-language checks over each domain name, the same ones an area name
 * gets (items.mjs, review.mjs). Whether the grouping is a good one is a
 * judgment no script makes.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { loadCheckedMap } from './check-map.mjs';
import { UsageError } from './errors.mjs';
import { readJson } from './json-file.mjs';
import { DOMAINS_FILE, domainsShapeProblems } from './domains-shape.mjs';
import { domainItems } from './items.mjs';
import { languageGate } from './language-check.mjs';
import { projectFiles } from './project-files.mjs';
import { reviewItems } from './review.mjs';

const duplicates = (ids) => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

/** Ids D1, D2, ... in order: each id that is used twice, and each id that is not the one its position calls for. */
function idProblems(doc) {
  const ids = doc.domains.map((domain) => domain.id);
  const repeated = duplicates(ids);
  const problems = repeated.map((id) => `domains: id ${id} is used more than once`);
  ids.forEach((id, i) => {
    if (id !== `D${i + 1}` && !repeated.includes(id)) problems.push(`domains[${i}].id: ${JSON.stringify(id)} is out of order; ids run D1, D2, ... without a gap, so this one is D${i + 1}`);
  });
  doc.domains.forEach((domain, i) => {
    if (domain.features.length === 0) problems.push(`domains[${i}]: ${domain.id} has no features; remove the domain or give it features`);
  });
  return problems;
}

/** Every map feature exactly once across the domains; each miss, each double assignment and each id that is not a feature is named. */
function conservationProblems(doc, map) {
  const known = new Set(map.features.map((feature) => feature.id));
  const owners = new Map();
  const problems = [];
  doc.domains.forEach((domain, i) => {
    domain.features.forEach((id, j) => {
      if (!known.has(id)) problems.push(`domains[${i}].features[${j}]: ${JSON.stringify(id)} is not a feature of the map`);
      else owners.set(id, [...(owners.get(id) ?? []), domain.id]);
    });
  });
  for (const feature of map.features) {
    const who = owners.get(feature.id);
    if (who === undefined) problems.push(`${feature.id}: not in any domain (${feature.name})`);
    else if (who.length > 1) {
      problems.push(new Set(who).size === 1
        ? `${feature.id}: listed more than once in ${who[0]}`
        : `${feature.id}: in more than one domain: ${who.join(' and ')}`);
    }
  }
  return problems;
}

/**
 * All problems of a domains document against the checked map. A shape problem
 * stops the rest: nothing else can be read from a malformed file.
 * `languageCheck` is the run's mode from `languageGate` (language-check.mjs).
 */
export function domainsProblems(doc, { map, files, memberDirs, languageCheck = null }) {
  const shape = domainsShapeProblems(doc);
  if (shape.length > 0) return shape;
  const problems = [];
  if (doc.language !== map.language) problems.push(`language: ${JSON.stringify(doc.language)} differs from the map's language ${JSON.stringify(map.language)}`);
  problems.push(...idProblems(doc), ...conservationProblems(doc, map));
  problems.push(...reviewItems(domainItems(doc), { files, memberDirs, languageCheck }).problems);
  return problems;
}

/** Read `<out>/domains.json`: a missing file is `{ ok: false, missing: true }`; unreadable JSON is `{ ok: false, line }`. */
export function readDomains(outDir) {
  const read = readJson(join(outDir, DOMAINS_FILE));
  if (read.missing) return { ok: false, missing: true, line: `${DOMAINS_FILE} ${read.reason}` };
  return read.ok ? read : { ok: false, line: `${DOMAINS_FILE} ${read.reason}` };
}

/**
 * The domains of a run whose map already passed: `{ doc }` when `<out>/domains.json`
 * exists and passes every check, `{ doc: null, lines }` otherwise (a missing
 * file has no lines). The commands that write the handbook fall back to the
 * map's areas then, and say so (entities.mjs).
 */
export function loadDomains(outDir, { map, files, memberDirs, languageCheck }) {
  const read = readDomains(outDir);
  if (!read.ok) return { doc: null, lines: read.missing ? [] : [read.line] };
  const lines = domainsProblems(read.value, { map, files, memberDirs, languageCheck });
  return lines.length > 0 ? { doc: null, lines } : { doc: read.value };
}

/** `handbook.mjs check-domains <out> --project <root>`: returns { status, lines }. Changes no file. */
export function checkDomains(outDir, root) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const loaded = loadCheckedMap(outDir, root);
  if (!loaded.ok) return { status: 1, lines: [...loaded.lines, 'Next: the map must pass check-map before its features can be grouped'] };
  const read = readDomains(outDir);
  if (read.missing) throw new UsageError(`${join(outDir, DOMAINS_FILE)} does not exist`);
  if (!read.ok) return { status: 1, lines: [read.line] };
  const gate = languageGate(outDir, loaded.map);
  if (!gate.ok) return { status: 1, lines: gate.lines };
  const problems = domainsProblems(read.value, { map: loaded.map, files: projectFiles(root), memberDirs: memberDirectories(root), languageCheck: gate.check });
  if (problems.length > 0) return { status: 1, lines: problems };
  return { status: 0, lines: [`domains ok: ${read.value.domains.length} domains, ${loaded.map.features.length} features`] };
}
