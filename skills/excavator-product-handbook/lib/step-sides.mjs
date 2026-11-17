/**
 * Which side of the system a step of an operation is on, from its citations (openspec change handbook-page-structure,
 * design D22), and the marking of the server steps for the page. A top-level directory whose entrypoint candidates are
 * only routes, jobs and program entries is the server side; one whose candidates are only pages is the page side; one with
 * both is neither. A step whose cited files all lie in server directories is a server step. The page folds each run of
 * consecutive server steps of an operation under the fixed text; the writer writes no marker.
 */

import { citationGroups, parseSpec } from './chapter-cites.mjs';

/** The line written after a run of server steps when the operation goes on; the page drops it and never shows it. */
export const SERVER_STEPS_END = '<!-- server-steps-end -->';

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const STEP = /^\d{1,9}[.)]\s+\S/;
const CONTINUED = /^\s+\S/;

const topOf = (file) => file.replace(/^\.\//, '').split('/')[0];

/** `Map` of top-level directory -> 'server' | 'client' | 'mixed', from the entrypoint candidates (`items` or the file). */
export function directorySides(candidates) {
  const items = Array.isArray(candidates) ? candidates : (candidates?.items ?? []);
  const sides = new Map();
  for (const item of items) {
    if (typeof item?.file !== 'string' || !item.file.includes('/')) continue;
    const side = item.kind === 'page' ? 'client' : 'server';
    const top = topOf(item.file);
    const was = sides.get(top);
    sides.set(top, was === undefined || was === side ? side : 'mixed');
  }
  return sides;
}

/** 'server', 'client' or null (no citation, cites both sides, or a directory that is neither) for the text of one step. */
export function stepSide(text, sides) {
  const found = new Set();
  for (const group of citationGroups(text)) {
    for (const spec of group.specs) {
      const parsed = parseSpec(spec);
      found.add(parsed.file === undefined ? null : (sides.get(topOf(parsed.file)) ?? null));
    }
  }
  if (found.size !== 1) return null;
  const [side] = found;
  return side === 'server' || side === 'client' ? side : null;
}

/**
 * `text` with each run of consecutive server steps of an operation marked: the line `marker` before the run and, when the
 * operation goes on after it, `SERVER_STEPS_END` after it. An operation is a level-3 heading under the level-2 heading
 * `operations`. A step is a top-level numbered item with its indented lines. An operation that already has a line equal to
 * `marker` (the writer wrote it) is left as it is. Returns `text` unchanged when nothing is marked, and always when the
 * project has no server directory or no page directory.
 */
export function markServerSteps(text, { sides, operations, marker }) {
  const wanted = typeof marker === 'string' ? marker.trim() : '';
  // Only a project with both a server and a page directory has steps to tell apart: in a server-only project every step
  // would fold, in one whose sides share a directory none can be told.
  const kinds = new Set(sides.values());
  if (wanted === '' || typeof operations !== 'string' || !kinds.has('server') || !kinds.has('client')) return text;
  const lines = text.split('\n');
  // Each operation: the range of its lines (after its heading, up to the next heading of level 3 or less).
  const ranges = [];
  let fenced = false;
  let inOperations = false;
  let open = null;
  const close = (end) => { if (open !== null) ranges.push({ start: open, end }); open = null; };
  lines.forEach((line, at) => {
    if (FENCE.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    const heading = HEADING.exec(line);
    if (heading === null || heading[1].length > 3) return;
    close(at);
    if (heading[1].length <= 2) inOperations = heading[1].length === 2 && heading[2] === operations;
    else if (inOperations) open = at + 1;
  });
  close(lines.length);

  const out = [...lines];
  // Work from the last operation backwards so that the indexes of the earlier ones stay right.
  for (const { start, end } of ranges.reverse()) {
    const body = lines.slice(start, end);
    if (body.some((line) => line.trim() === wanted)) continue;
    const steps = [];
    let inFence = false;
    let current = null;
    body.forEach((line, k) => {
      if (FENCE.test(line)) { inFence = !inFence; current = null; return; }
      if (inFence) return;
      if (STEP.test(line)) { current = { first: k, last: k }; steps.push(current); return; }
      if (current !== null && CONTINUED.test(line)) { current.last = k; return; }
      if (line.trim() !== '') current = null;
    });
    for (const step of steps) step.side = stepSide(body.slice(step.first, step.last + 1).join('\n'), sides);
    // Runs: consecutive server steps with only blank lines between them.
    const runs = [];
    steps.forEach((step, k) => {
      if (step.side !== 'server') return;
      const previous = runs[runs.length - 1];
      const joined = previous !== undefined && previous.to === k - 1 && body.slice(steps[k - 1].last + 1, step.first).every((line) => line.trim() === '');
      if (joined) { previous.to = k; previous.last = step.last; } else runs.push({ from: k, to: k, first: step.first, last: step.last });
    });
    if (runs.length === 0) continue;
    const marked = [...body];
    for (const run of [...runs].reverse()) {
      const rest = body.slice(run.last + 1).some((line) => line.trim() !== '');
      if (rest) marked.splice(run.last + 1, 0, '', SERVER_STEPS_END, '');
      // Blank lines around the marker: without one before it, it would read as a continuation of the step before.
      marked.splice(run.first, 0, '', wanted, '');
    }
    out.splice(start, end - start, ...marked);
  }
  return out.join('\n');
}
