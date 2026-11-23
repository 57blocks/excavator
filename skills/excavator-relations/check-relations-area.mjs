#!/usr/bin/env node
/**
 * check-relations-area.mjs
 *
 * The analyzer's self-check: runs merge-relations.mjs's own end check
 * (checkEnd) over one area's output and lists every end the merge would
 * reject, with the reason, before the analyzer finishes. It reads only the
 * area's context file, its output and the cited source files; it writes
 * nothing and decides nothing: the merge checks everything again.
 *
 * Usage:
 *   node check-relations-area.mjs <area context file>
 *
 * Prints `check <areaId>: ends=N accepted=A rejected=R`, then one line per
 * rejected end: `rejected relations[i].<role> <file>:<line> <reason>: <detail>`.
 * Exit 0 when nothing is rejected, 1 when some end is, 2 when the output
 * cannot be checked at all (missing, not JSON, another run's token).
 */

import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptOutput, checkEnd, endsOf, insideRoot } from './merge-relations.mjs';

/**
 * Check one area's output against its context. Pure apart from `readLines`.
 * Returns { status, reason?, ends, accepted, rejected: [{ index, role, file, line, rejection, detail }] }.
 */
export function checkArea({ context, outputText, readLines }) {
  const { areaId, token } = context.areaRun ?? {};
  const accepted = acceptOutput({ token, areaId, text: outputText });
  if (accepted.status !== 'accepted') return { status: accepted.status, reason: accepted.reason ?? null, ends: 0, accepted: 0, rejected: [] };
  const areaFiles = new Set((context.files ?? []).map((f) => f.file));
  const entryPoints = new Map((context.files ?? []).filter((f) => Array.isArray(f.entryPoints) && f.entryPoints.length > 0)
    .map((f) => [f.file, f.entryPoints.map((e) => ({ ...e, file: f.file, routeKind: 'http' }))]));
  const { ends } = endsOf(areaId, accepted.output);
  const rejected = [];
  for (const end of ends) {
    const result = checkEnd({ end, readLines, areaFiles, entryPoints });
    if (result.ok) continue;
    rejected.push({
      index: end.index, role: end.role,
      file: typeof end.raw?.file === 'string' ? end.raw.file : null,
      line: Number.isInteger(end.raw?.line) ? end.raw.line : null,
      rejection: result.rejection, detail: result.detail,
    });
  }
  return { status: 'accepted', ends: ends.length, accepted: ends.length - rejected.length, rejected };
}

export function reportLines(areaId, result) {
  if (result.status !== 'accepted') return [`check ${areaId}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`];
  return [
    `check ${areaId}: ends=${result.ends} accepted=${result.accepted} rejected=${result.rejected.length}`,
    ...result.rejected.map((r) => `rejected relations[${r.index}].${r.role} ${r.file ?? '?'}:${r.line ?? '?'} ${r.rejection}: ${r.detail}`),
  ];
}

export function runCheck(contextPath, { stdout = (t) => process.stdout.write(t) } = {}) {
  const context = JSON.parse(readFileSync(contextPath, 'utf-8'));
  let outputText = null;
  try {
    outputText = readFileSync(context.output, 'utf-8');
  } catch { /* missing: reported by acceptOutput */ }
  const cache = new Map();
  const readLines = (file) => {
    const inside = insideRoot(file);
    if (inside === null) return null;
    if (!cache.has(inside)) {
      let lines = null;
      try {
        lines = readFileSync(join(context.projectRoot, inside), 'utf-8').split(/\r?\n/);
      } catch { /* unreadable: null */ }
      cache.set(inside, lines);
    }
    return cache.get(inside);
  };
  const result = checkArea({ context, outputText, readLines });
  stdout(`${reportLines(context.areaRun?.areaId ?? '?', result).join('\n')}\n`);
  if (result.status !== 'accepted') return 2;
  return result.rejected.length > 0 ? 1 : 0;
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) {
  const contextPath = process.argv[2];
  if (!contextPath) {
    process.stderr.write('usage: node check-relations-area.mjs <area context file>\n');
    process.exit(2);
  }
  try {
    process.exit(runCheck(contextPath));
  } catch (error) {
    process.stderr.write(`check-relations-area.mjs failed: ${error.message}\n`);
    process.exit(2);
  }
}

export default { checkArea, reportLines, runCheck };
