/**
 * The parts of the business-processes chapter (openspec change handbook-process-review, design D7, the change after S4):
 * one part per group of the design-problems domain batches (`reviewBatches`), each written by one writer to
 * entries/processes/<id>.md and joined into chapters/processes.md by `processes join`. A process belongs to the part of
 * its first step's feature; its steps may name any feature. Commands: check-part, parts, reset, skip, join.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { processesChapterReasons } from './check.mjs';
import { readMapOrNull } from './item-numbers.mjs';
import { parseProcesses } from './processes-parse.mjs';
import { projectFiles } from './project-files.mjs';
import { reviewBatches } from './review-batches.mjs';
import { loadUi } from './ui.mjs';

const HEADER_LINES = 2;
const partFile = (outDir, id) => join(outDir, 'entries', 'processes', `${id}.md`);

/** `{ ok: true, part: { id, name, features } }` or `{ ok: false, lines }` naming the valid ids. */
export function findPart(outDir, id) {
  const batches = reviewBatches(outDir);
  if (!batches.ok) return { ok: false, lines: batches.lines };
  const part = batches.batches.find((batch) => batch.id === id);
  if (part === undefined) return { ok: false, lines: [`${id} is not a part; the parts are ${batches.batches.map((batch) => batch.id).join(', ')}`] };
  return { ok: true, part };
}

/** Moves the line number of a reason from the joined chapter to the part file (the title and its blank line are not in the part). */
function shifted(reason) {
  return reason.replace(/^line (\d+): /, (_, n) => `line ${Math.max(1, Number(n) - HEADER_LINES)}: `);
}

/** The level-1 heading lines of `text`, outside code fences. */
function levelOneLines(text) {
  const lines = [];
  let fenced = false;
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, at) => {
    if (/^\s*```/.test(raw)) fenced = !fenced;
    else if (!fenced && /^#\s/.test(raw)) lines.push(at + 1);
  });
  return lines;
}

/** The reasons part `part` ({ id, name, features }) is refused; `ctx` is { files, memberDirs, cache, ids, ui }. */
function partReasons(outDir, part, ctx) {
  const path = partFile(outDir, part.id);
  if (!existsSync(path)) return ['the part was not written'];
  const text = readFileSync(path, 'utf-8');
  if (text.trim() === '') return [];
  const { strings } = ctx.ui;
  const title = strings['chapter.processes.title'];
  const reasons = [];
  for (const line of levelOneLines(text)) reasons.push(`line ${line}: a part has no level-1 heading; the chapter title is added when the parts are joined`);
  for (const process of parseProcesses(text)) {
    const first = process.steps[0];
    if (first !== undefined && first.feature !== null && !part.features.includes(first.feature)) {
      reasons.push(`line ${process.line}: process "${process.name}" starts with ${first.feature}, which is not a feature of this part (${part.name}); a process belongs to the part of its first step's feature`);
    }
  }
  const joined = `# ${title}\n\n${text}`;
  const general = processesChapterReasons(outDir, joined, { ids: ctx.ids, strings, files: ctx.files, memberDirs: ctx.memberDirs, cache: ctx.cache }).map(shifted);
  return [...new Set([...reasons, ...general])];
}

function openContext(outDir, root) {
  const batches = reviewBatches(outDir);
  if (!batches.ok) return { ok: false, result: { status: 1, lines: batches.lines } };
  const ui = loadUi(outDir);
  if (!ui.ok) return { ok: false, result: { status: 1, lines: ui.lines } };
  const map = readMapOrNull(outDir);
  const files = projectFiles(root);
  return { ok: true, batches: batches.batches, ui, ids: map.features.map((feature) => feature.id), files, memberDirs: memberDirectories(files.root), cache: new Map() };
}

/** `processes check-part <out> <part> --project <root>`. */
export function checkPart(outDirArg, id, root) {
  const outDir = resolve(outDirArg);
  const ctx = openContext(outDir, root);
  if (!ctx.ok) return ctx.result;
  const part = ctx.batches.find((batch) => batch.id === id);
  if (part === undefined) return { status: 1, lines: [`${id} is not a part; the parts are ${ctx.batches.map((batch) => batch.id).join(', ')}`] };
  const reasons = partReasons(outDir, part, ctx);
  return reasons.length === 0 ? { status: 0, lines: [`${id}: passed`] } : { status: 1, lines: reasons };
}

function states(outDir, ctx) {
  return ctx.batches.map((part) => {
    const reasons = partReasons(outDir, part, ctx);
    return { part, state: reasons.length === 0 ? 'done' : 'write', reasons };
  });
}

/** `processes parts <out> --project <root>`: `<id><TAB><state><TAB><name><TAB><feature ids>` per part and the reasons of a part that does not pass. */
export function processesParts(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const ctx = openContext(outDir, root);
  if (!ctx.ok) return ctx.result;
  const lines = [];
  for (const { part, state, reasons } of states(outDir, ctx)) {
    lines.push([part.id, state, part.name, part.features.join(',')].join('\t'), ...reasons.map((reason) => `  ${reason}`));
  }
  return { status: 0, lines };
}

/** `processes reset <out> <part>` deletes the part file; `processes skip <out> <part>` writes an empty one. */
export function resetPart(outDirArg, id, { empty }) {
  const outDir = resolve(outDirArg);
  const found = findPart(outDir, id);
  if (!found.ok) return { status: 1, lines: found.lines };
  const path = partFile(outDir, id);
  if (empty) {
    mkdirSync(join(outDir, 'entries', 'processes'), { recursive: true });
    writeFileSync(path, '');
    return { status: 0, lines: [`${id}: emptied`] };
  }
  rmSync(path, { force: true });
  return { status: 0, lines: [`${id}: cleared`] };
}

/** `processes join <out> --project <root>`: chapters/processes.md from the parts when every part is done. */
export function joinParts(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const ctx = openContext(outDir, root);
  if (!ctx.ok) return ctx.result;
  const all = states(outDir, ctx);
  const pending = all.filter((entry) => entry.state !== 'done');
  if (pending.length > 0) return { status: 1, lines: pending.map(({ part, state }) => [part.id, state, part.name].join('\t')) };
  const bodies = all.map(({ part }) => readFileSync(partFile(outDir, part.id), 'utf-8').trim()).filter((text) => text !== '');
  const text = `# ${ctx.ui.strings['chapter.processes.title']}\n\n${bodies.join('\n\n')}\n`;
  mkdirSync(join(outDir, 'chapters'), { recursive: true });
  writeFileSync(join(outDir, 'chapters', 'processes.md'), text);
  return { status: 0, lines: [`processes.md: joined ${bodies.length} parts, ${parseProcesses(text).length} processes`] };
}
