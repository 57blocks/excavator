/**
 * The process batches of the design-problems phase (openspec change handbook-process-review, D8): when the business
 * processes chapter passed, `review facts` packs consecutive processes into batches p1..pn whose step counts add up to
 * at most PROCESS_BATCH_STEPS and records them, with the digest of the chapter, in entries/review-processes.json.
 * A different digest clears every p* batch: the process numbers changed, so the old items name the wrong processes.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { isObject, readJson, writeJson } from './json-file.mjs';
import { parseProcesses } from './processes-parse.mjs';
import { REMOVED_FILE, REVIEW_DIR } from './review-files.mjs';
import { loadStateV2 } from './state-v2.mjs';

export const PROCESSES_FILE = 'entries/review-processes.json';
export const PROCESSES_FORMAT = 'excavator-product-handbook-review-processes/1';
export const PROCESS_BATCH_STEPS = 60;
const PROCESS_BATCH_ID = /^p[1-9][0-9]*$/;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const processesDigest = (outDir) => {
  const path = join(outDir, 'chapters', 'processes.md');
  return existsSync(path) ? sha(readFileSync(path)) : null;
};

/** Consecutive processes in groups whose step sums stay within the limit; an oversized process is a group alone. */
export function packProcesses(processes) {
  const groups = [];
  let sum = 0;
  for (const process of processes) {
    const last = groups[groups.length - 1];
    if (last !== undefined && sum + process.steps <= PROCESS_BATCH_STEPS) {
      last.push(process);
      sum += process.steps;
    } else {
      groups.push([process]);
      sum = process.steps;
    }
  }
  return groups;
}

/** Deletes the files and removal records of every p* batch; returns how many files went. */
function clearProcessBatches(outDir) {
  const dir = join(outDir, REVIEW_DIR);
  let count = 0;
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!/^p[1-9][0-9]*(?:\.unpruned|\.verdicts)?\.json$/.test(name)) continue;
      rmSync(join(dir, name), { force: true });
      count += 1;
    }
  }
  const recorded = readJson(join(outDir, REMOVED_FILE));
  if (recorded.ok && Array.isArray(recorded.value?.removed)) {
    writeJson(join(outDir, REMOVED_FILE), { removed: recorded.value.removed.filter((entry) => !PROCESS_BATCH_ID.test(String(entry.batch))) });
  }
  return count;
}

const readFile = (outDir) => {
  const read = readJson(join(outDir, PROCESSES_FILE));
  return read.ok && isObject(read.value) && Array.isArray(read.value.batches) ? read.value : null;
};

/**
 * Writes or removes entries/review-processes.json for the chapter as it is now, clearing the p* batches when the
 * chapter's digest differs from the recorded one. Returns the line `review facts` prints.
 */
export function assignProcessBatches(outDir) {
  const loaded = loadStateV2(outDir);
  const digest = processesDigest(outDir);
  const passed = loaded.ok && loaded.state.chapters.processes?.status === 'passed' && digest !== null;
  const old = readFile(outDir);
  if (!passed) {
    rmSync(join(outDir, PROCESSES_FILE), { force: true });
    return 'Process batches: none (the business processes chapter has not passed)';
  }
  const parsed = parseProcesses(readFileSync(join(outDir, 'chapters', 'processes.md'), 'utf-8'));
  const processes = parsed.map((process, at) => {
    const steps = process.steps.filter((step) => step.feature !== null);
    return { id: `P${at + 1}`, name: process.name, features: [...new Set(steps.map((step) => step.feature))], steps: process.steps.length };
  });
  const batches = packProcesses(processes).map((group, at) => ({ id: `p${at + 1}`, processes: group }));
  if (old === null || old.digest !== digest) clearProcessBatches(outDir);
  writeJson(join(outDir, PROCESSES_FILE), { format: PROCESSES_FORMAT, digest, batches });
  return `Process batches: ${batches.length} (${processes.length} processes)`;
}

/** The process batches `[{ id, name, process: true, processes, features }]` of the recorded file; empty when it is missing or unreadable. */
export function processBatches(outDir) {
  const file = readFile(outDir);
  if (file === null) return [];
  return file.batches.filter((batch) => isObject(batch) && PROCESS_BATCH_ID.test(String(batch.id)) && Array.isArray(batch.processes) && batch.processes.length > 0).map((batch) => {
    const first = batch.processes[0].id;
    const last = batch.processes[batch.processes.length - 1].id;
    return {
      id: batch.id,
      name: first === last ? first : `${first}-${last}`,
      process: true,
      processes: batch.processes,
      features: [...new Set(batch.processes.flatMap((process) => process.features ?? []))],
    };
  });
}

/** `review processes <out> <batch>`: the PROCESS line and every non-empty line of each process of one process batch. */
export function reviewProcessLines(outDir, id) {
  const batches = processBatches(outDir);
  const batch = batches.find((entry) => entry.id === id);
  if (batch === undefined) {
    return { status: 1, lines: [`${id} is not a process batch; the process batches are ${batches.length === 0 ? 'none' : batches.map((entry) => entry.id).join(', ')}`] };
  }
  const digest = processesDigest(outDir);
  if (digest === null || digest !== readFile(outDir).digest) return { status: 1, lines: ['processes.md changed since review facts; run review facts again'] };
  const text = readFileSync(join(outDir, 'chapters', 'processes.md'), 'utf-8');
  const all = text.replace(/\r\n?/g, '\n').split('\n');
  const parsed = parseProcesses(text);
  const lines = [];
  for (const process of batch.processes) {
    const at = Number(process.id.slice(1)) - 1;
    const from = parsed[at].line;
    const to = at + 1 < parsed.length ? parsed[at + 1].line - 1 : all.length;
    lines.push(['PROCESS', process.id, process.name, process.features.join(',')].join('\t'));
    for (let n = from + 1; n <= to; n += 1) if (all[n - 1].trim() !== '') lines.push(`processes.md:${n}: ${all[n - 1]}`);
  }
  return { status: 0, lines };
}
