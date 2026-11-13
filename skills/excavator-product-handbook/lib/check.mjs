/**
 * check <out> [<chapter>...] [--before cross|review] --project <root>: the final check of the
 * Markdown chapters under <out>/chapters/, recorded in state.json (format /2), or the
 * gate that says whether the cross chapters may be written. Never changes a chapter.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { CROSS_CHAPTERS, lintChapter } from './chapter-lint.mjs';
import { domainsListReasons } from './domains-list.mjs';
import { UsageError } from './errors.mjs';
import { readJson } from './json-file.mjs';
import { withStateLock } from './lock.mjs';
import { projectFiles } from './project-files.mjs';
import { loadStateV2, saveStateV2 } from './state-v2.mjs';
import { loadUi } from './ui.mjs';

const NEXT_RETRY = 'Next: delete each failed chapter whose attempt is 1 and dispatch it again with its reasons; keep the chapters that failed twice';
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const stem = (name) => name.replace(/\.md$/, '');

/** The feature ids of map.json, or null when the map is missing or has no features list. */
function featureIds(outDir) {
  const read = readJson(join(outDir, 'map.json'));
  if (!read.ok || !Array.isArray(read.value?.features)) return null;
  return read.value.features.map((feature) => feature.id);
}

function kindOf(name, ids) {
  if (name === 'system') return 'system';
  if (CROSS_CHAPTERS.includes(name)) return 'cross';
  return ids.includes(name) ? 'feature' : null;
}

/** The gate before cross chapters (`target` cross) or the design problems (`review`): the map exists and every feature has a passed chapter or one that failed twice. */
function beforeGate(outDir, target) {
  const ids = featureIds(outDir);
  if (ids === null) {
    return { status: 1, lines: ['map.json is missing or has no features; write and check the map first'] };
  }
  const loaded = loadStateV2(outDir);
  if (!loaded.ok) return { status: 1, lines: [loaded.line] };
  const missing = ids.filter((id) => {
    const record = loaded.state.chapters[id];
    return !(record !== undefined && (record.status === 'passed' || (record.status === 'failed' && record.attempts >= 2)));
  });
  const [ready, next] = target === 'review'
    ? ['Design problems', 'Next: write and check these features before the design problems']
    : ['Cross chapters', 'Next: write and check these features before the cross chapters'];
  if (missing.length === 0) return { status: 0, lines: [`${ready}: ready (${ids.length} features)`] };
  return { status: 1, lines: [...missing.map((id) => `missing: ${id}`), next] };
}

function checkChapters(outDir, names, root, record) {
  const dir = join(outDir, 'chapters');
  const available = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.md')).map(stem).sort() : [];
  const wanted = names.length > 0 ? [...new Set(names.map(stem))] : available;
  const ui = loadUi(outDir);
  if (!ui.ok) return { status: 1, lines: ui.lines };
  const ids = featureIds(outDir) ?? [];
  const loaded = loadStateV2(outDir);
  if (!loaded.ok) return { status: 1, lines: [loaded.line] };
  const state = loaded.state;
  const files = projectFiles(root);
  const memberDirs = memberDirectories(files.root);
  const cache = new Map();
  const lines = [];
  let failed = false;
  for (const name of wanted) {
    const path = join(dir, `${name}.md`);
    const label = `chapters/${name}.md`;
    const kind = kindOf(name, ids);
    let reasons;
    let bytes = null;
    let listHash = null;
    if (!existsSync(path)) reasons = ['the file does not exist'];
    else if (kind === null) reasons = [`unknown chapter: not system, a cross chapter or a feature id of map.json`];
    else {
      bytes = readFileSync(path);
      const chapterText = bytes.toString('utf-8');
      reasons = lintChapter(chapterText, { kind, name, files, strings: ui.strings, memberDirs, cache });
      if (name === 'domains') {
        const list = domainsListReasons(outDir, chapterText, ids);
        reasons = [...reasons, ...list.reasons];
        listHash = list.hash;
      }
    }
    const status = reasons.length === 0 ? 'passed' : 'failed';
    if (status === 'failed') failed = true;
    let attempts = null;
    if (record && bytes !== null) {
      // For domains the attempt counts a change of either file, so a rewrite that only fixes domains.json is a new attempt.
      const hash = name === 'domains' && listHash !== null ? sha256(Buffer.concat([bytes, Buffer.from(`\n${listHash}`)])) : sha256(bytes);
      const before = state.chapters[name];
      attempts = before === undefined ? 1 : before.sha256 === hash ? before.attempts : before.attempts + 1;
      state.chapters[name] = { status, attempts, reasons, sha256: hash, ...(name === 'domains' && status === 'passed' ? { json: listHash } : {}) };
    }
    lines.push(status === 'passed' ? `${label}: passed` : `${label}: failed${attempts === null ? '' : ` (attempt ${attempts})`}`);
    for (const reason of reasons) lines.push(`  - ${reason}`);
  }
  if (record) saveStateV2(outDir, state);
  lines.push(failed ? NEXT_RETRY : 'Next: go on');
  return { status: failed ? 1 : 0, lines };
}

/** Returns { status, lines }. */
export function checkCommand(outDir, names, root, { before, record = true } = {}) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  if (before !== undefined) {
    if (before !== 'cross' && before !== 'review') throw new UsageError('--before takes cross or review');
    if (!record) throw new UsageError(`--no-record cannot be used with --before ${before}`);
    return beforeGate(outDir, before);
  }
  return record ? withStateLock(outDir, () => checkChapters(outDir, names, root, true)) : checkChapters(outDir, names, root, false);
}
