/**
 * domains.json (openspec change handbook-page-domain-map, design D1 and D2): the business domains
 * and the hand-overs between them, written beside chapters/domains.md by the writer of that
 * chapter. `domainsListReasons` is the check `check domains` adds to the chapter's own; the
 * heading helpers cut domains.md into the `## <name>` sections both the check and the page use.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { citationGroups } from './chapter-cites.mjs';
import { isObject } from './json-file.mjs';

export const DOMAINS_FILE = 'domains.json';
const FENCE = /^\s*```/;

export const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The level-2 headings of `text` outside fences: `{ name, line }` (line index), in document order. */
export function levelTwoHeadings(text) {
  const out = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const found = /^##\s+(.*?)\s*#*\s*$/.exec(line);
      if (found !== null && !line.startsWith('###')) out.push({ name: found[1].trim(), line: index });
    }
  });
  return out;
}

/** The text between the heading `name` and the next level-2 heading (or the end), heading line dropped; null when there is no such heading. */
export function domainSection(text, name) {
  const headings = levelTwoHeadings(text);
  const at = headings.findIndex((heading) => heading.name === name);
  if (at === -1) return null;
  const lines = text.split('\n');
  const end = at + 1 < headings.length ? headings[at + 1].line : lines.length;
  return lines.slice(headings[at].line + 1, end).join('\n').trim();
}

const isStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const sameKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Shape problems of the parsed file; an empty list means the rest of the checks can read it. */
function shapeProblems(value) {
  if (!isObject(value) || !sameKeys(value, ['domains', 'handovers'])) return ['domains.json must be an object with exactly the keys "domains" and "handovers"'];
  const problems = [];
  if (!Array.isArray(value.domains)) problems.push('"domains" must be a list');
  else {
    value.domains.forEach((domain, index) => {
      if (!isObject(domain) || !sameKeys(domain, ['name', 'features']) || typeof domain.name !== 'string' || !isStrings(domain.features)) {
        problems.push(`domains[${index}] must be an object with exactly "name" (text) and "features" (list of texts)`);
      }
    });
  }
  if (!Array.isArray(value.handovers)) problems.push('"handovers" must be a list');
  else {
    value.handovers.forEach((item, index) => {
      if (!isObject(item) || !sameKeys(item, ['from', 'to', 'what', 'cites']) || typeof item.from !== 'string' || typeof item.to !== 'string' || typeof item.what !== 'string' || !isStrings(item.cites)) {
        problems.push(`handovers[${index}] must be an object with exactly "from", "to", "what" (texts) and "cites" (list of texts)`);
      }
    });
  }
  return problems;
}

function domainProblems(domains, headings) {
  const problems = [];
  const seen = new Set();
  domains.forEach((domain, index) => {
    const name = domain.name.trim();
    const label = name === '' ? `domains[${index}]` : `domain "${domain.name}"`;
    if (name === '') problems.push(`${label}: the name is empty`);
    else {
      if (seen.has(name)) problems.push(`${label}: the name is listed more than once`);
      seen.add(name);
      if (domain.name !== name || !headings.includes(name)) problems.push(`${label}: the name is not exactly the text of a level-2 heading of domains.md`);
    }
  });
  return problems;
}

function featureProblems(domains, ids) {
  const where = new Map();
  for (const domain of domains) for (const id of domain.features) where.set(id, [...(where.get(id) ?? []), domain.name]);
  const problems = [];
  const missing = ids.filter((id) => !where.has(id));
  if (missing.length > 0) problems.push(`features not in any domain: ${missing.join(', ')}`);
  for (const [id, names] of where) {
    if (names.length > 1) problems.push(`feature ${id} is listed more than once (${names.map((name) => `"${name}"`).join(', ')})`);
  }
  const unknown = [...where.keys()].filter((id) => !ids.includes(id));
  if (unknown.length > 0) problems.push(`feature ids not in map.json: ${unknown.join(', ')}`);
  return problems;
}

function parseCite(cite) {
  const found = /^(.+):(\d+)-(\d+)$/.exec(cite);
  if (found === null) return false;
  const a = Number(found[2]);
  const b = Number(found[3]);
  return a >= 1 && a <= b;
}

function handoverProblems(handovers, names, text) {
  const problems = [];
  const seen = new Set();
  handovers.forEach((item, index) => {
    const label = `hand-over ${index} (${item.from} -> ${item.to})`;
    if (!names.has(item.from)) problems.push(`${label}: "from" is not a listed domain`);
    if (!names.has(item.to)) problems.push(`${label}: "to" is not a listed domain`);
    if (item.from === item.to) problems.push(`${label}: "from" and "to" are the same domain; hand-overs inside a domain stay in the chapter`);
    const key = JSON.stringify([item.from, item.to, item.what]);
    if (seen.has(key)) problems.push(`${label}: the same hand-over (from, to, what) is listed more than once`);
    seen.add(key);
    if (item.what.trim() === '') problems.push(`${label}: "what" is empty`);
    else if (item.what.includes('`') || citationGroups(item.what).length > 0) problems.push(`${label}: "what" holds a backtick or a citation group; write plain reader text`);
    if (item.cites.length === 0) problems.push(`${label}: "cites" is empty`);
    for (const cite of item.cites) {
      if (!parseCite(cite)) problems.push(`${label}: citation "${cite}" is not written as <path>:<a>-<b> with 1 <= a <= b`);
      else if (!text.includes(`\`${cite}\``)) problems.push(`${label}: citation "${cite}" does not occur in domains.md; copy it from the chapter line of this hand-over`);
    }
  });
  return problems;
}

/**
 * `{ reasons, hash }` for `<outDir>/domains.json` against the chapter `text` of domains.md and the map's feature `ids`.
 * `hash` is the sha256 of the file's bytes, or null when the file is missing; reasons are empty when it is sound.
 */
export function domainsListReasons(outDir, text, ids) {
  const path = join(outDir, DOMAINS_FILE);
  if (!existsSync(path)) return { reasons: ['domains.json: the file does not exist; write it beside the chapter'], hash: null };
  const bytes = readFileSync(path);
  const hash = sha256Of(bytes);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf-8'));
  } catch (error) {
    return { reasons: [`domains.json: is not valid JSON (${error.message})`], hash };
  }
  const shape = shapeProblems(value);
  if (shape.length > 0) return { reasons: shape.map((line) => `domains.json: ${line}`), hash };
  const headings = levelTwoHeadings(text).map((heading) => heading.name);
  const names = new Set(value.domains.map((domain) => domain.name));
  const problems = [
    ...domainProblems(value.domains, headings),
    ...featureProblems(value.domains, ids),
    ...handoverProblems(value.handovers, names, text),
  ];
  return { reasons: problems.map((line) => `domains.json: ${line}`), hash };
}
