/**
 * The parts of the page data that come from domains.json and the chapters' headings (openspec
 * change handbook-page-domain-map, design D3): the business domains with their hand-overs, the
 * lead sentence of the system, and the search index. Reads the file only when the state record of
 * the `domains` chapter says it was checked, and says in `state` when it was not.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOMAINS_FILE, domainSection, sha256Of } from './domains-list.mjs';
import { productText } from './md-views.mjs';

const FENCE = /^\s*```/;
const TABLE = /^\s*\|/;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;
const OPEN = `(${String.fromCharCode(0xff08)}`;
const CLOSE = `)${String.fromCharCode(0xff09)}`;
const FEATURE_MENTION = new RegExp(`[${OPEN}]F(\\d+)[${CLOSE}]`, 'g');

const startsBlock = (line) => TABLE.test(line) || LIST.test(line) || HEADING.test(line) || FENCE.test(line);

/** The first paragraph of `text` outside fences (consecutive lines that are not a table, list or heading), trimmed; '' when there is none. */
export function firstParagraph(text) {
  let fenced = false;
  const lines = [];
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      if (lines.length > 0) break;
    } else if (!fenced) {
      if (line.trim() === '' || startsBlock(line)) {
        if (lines.length > 0) break;
      } else lines.push(line);
    }
  }
  return lines.join('\n').trim();
}

/** `{ intro, body }` of a domain section: its first paragraph block, and the rest; intro is '' when the section starts with something else. */
export function splitSection(section) {
  const lines = section.split('\n');
  let at = 0;
  while (at < lines.length && lines[at].trim() === '') at += 1;
  const start = at;
  while (at < lines.length && lines[at].trim() !== '' && !startsBlock(lines[at])) at += 1;
  if (at === start) return { intro: '', body: section.trim() };
  return { intro: lines.slice(start, at).join('\n').trim(), body: lines.slice(at).join('\n').trim() };
}

/** `{ state, value }`: why the checked list can or cannot be used (`value` is the parsed file when `state` is `ok`). */
function loadList(outDir, record) {
  const path = join(outDir, DOMAINS_FILE);
  if (record === undefined || !existsSync(path)) return { state: 'missing' };
  if (record.status !== 'passed') return { state: 'failed' };
  if (typeof record.json !== 'string') return { state: 'missing' };
  const bytes = readFileSync(path);
  if (sha256Of(bytes) !== record.json) return { state: 'changed' };
  try {
    return { state: 'ok', value: JSON.parse(bytes.toString('utf-8')) };
  } catch {
    return { state: 'failed' };
  }
}

/** The `domains` key of the page data. `views` are the page's views. */
export function domainsData(run, views) {
  const record = run.state.chapters.domains;
  const loaded = loadList(run.outDir, record);
  const empty = { state: loaded.state, list: [], handovers: [] };
  const chapter = run.chapters.get('domains');
  if (loaded.state !== 'ok') return empty;
  if (chapter === undefined) return { ...empty, state: 'missing' };
  const technical = views.includes('technical');
  const ids = new Set(run.map.features.map((feature) => feature.id));
  const idOf = new Map(loaded.value.domains.map((domain, index) => [domain.name, `d${index + 1}`]));
  const texts = (raw) => Object.fromEntries(views.map((view) => [view, view === 'product' ? productText(raw) : raw]));
  const list = loaded.value.domains.map((domain) => {
    const { intro, body } = splitSection(domainSection(chapter.text, domain.name) ?? '');
    return { id: idOf.get(domain.name), name: domain.name, features: [...domain.features], intro: texts(intro), body: texts(body) };
  });
  const handovers = loaded.value.handovers.map((item) => {
    const mentioned = [...item.what.matchAll(FEATURE_MENTION)].map((found) => `F${found[1]}`).filter((id) => ids.has(id));
    return {
      from: idOf.get(item.from),
      to: idOf.get(item.to),
      what: item.what,
      features: [...new Set(mentioned)],
      ...(technical ? { cites: [...item.cites] } : {}),
    };
  });
  return { state: 'ok', list, handovers };
}

/** The `## ` and `### ` headings of `text` outside fences, in document order: their text. */
export function pageHeadings(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const found = /^#{2,3}\s+(.*?)\s*#*\s*$/.exec(line);
      if (found !== null && !line.startsWith('####')) out.push(found[1]);
    }
  }
  return out;
}

/** The lead of the page: the first paragraph of the system chapter's product text, '' without a system chapter. */
export function leadOf(run) {
  const system = run.chapters.get('system');
  return system === undefined ? '' : firstParagraph(productText(system.text));
}

/** The search index: the domains, then each chapter the outline places with its `##` and `###` headings. */
export function searchIndex(domains, chapterBlocks, run) {
  const items = domains.list.map((domain) => ({ kind: 'domain', title: domain.name, chapter: null, domain: domain.id, heading: null }));
  for (const block of chapterBlocks) {
    items.push({ kind: 'chapter', title: block.title, chapter: block.block, domain: null, heading: null });
    pageHeadings(productText(run.chapters.get(block.block).text)).forEach((title, index) => {
      items.push({ kind: 'heading', title, chapter: block.block, domain: null, heading: index });
    });
  }
  return items;
}
