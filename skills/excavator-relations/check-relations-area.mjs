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
 * Prints `check <areaId>: ends=N accepted=A rejected=R` (and ` notices=K`
 * when K > 0), then one line per rejected end:
 * `rejected relations[i].<role> <file>:<line> <reason>: <detail>`, then one
 * line per accepted external end whose id the merge cannot rest on what the
 * analyzer wrote: `notice relations[i].<role> <file>:<line> <reason>: <detail>`
 * with reason `transport-name` (a library or protocol name and no host: the
 * end will be address-unresolved) or `host-not-quoted` (no cited line holds
 * the host, so the id comes from the name), then one line per call line of
 * the area's files the output does not account for (merge-relations.mjs
 * accountCallLines: no end, no evidence line of this output, no skippedLines
 * entry, and its file not in skippedFiles):
 * `unaccounted <file>:<line> <signal>: <text>`. The header gives
 * ` call-lines=C unaccounted=U` when the area has call lines. A notice does
 * not change the exit: 0 when nothing is rejected or unaccounted, 1 when some
 * end is rejected or some call line unaccounted, 2 when the output cannot be
 * checked at all (missing, not JSON, another run's token).
 */

import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountCallLines, acceptOutput, checkEnd, endsOf, insideRoot } from './merge-relations.mjs';

/**
 * Check one area's output against its context. Pure apart from `readLines`.
 * Returns { status, reason?, ends, accepted, rejected: [{ index, role, file, line, rejection, detail }],
 *   notices: [{ index, role, file, line, notice, detail }], callLines, unaccounted: [{ file, line, signal, text }] }.
 */
export function checkArea({ context, outputText, readLines }) {
  const { areaId, token } = context.areaRun ?? {};
  const accepted = acceptOutput({ token, areaId, text: outputText });
  if (accepted.status !== 'accepted') return { status: accepted.status, reason: accepted.reason ?? null, ends: 0, accepted: 0, rejected: [], notices: [], callLines: 0, unaccounted: [] };
  const areaFiles = new Set((context.files ?? []).map((f) => f.file));
  const entryPoints = new Map((context.files ?? []).filter((f) => Array.isArray(f.entryPoints) && f.entryPoints.length > 0)
    .map((f) => [f.file, f.entryPoints.map((e) => ({ ...e, file: f.file, routeKind: 'http' }))]));
  const { ends, skipped, skippedLines } = endsOf(areaId, accepted.output);
  const rejected = [];
  const notices = [];
  const ended = new Map();
  const evidence = new Map();
  const rejectedAt = new Map();
  const at = (map, file, line) => { if (!map.has(file)) map.set(file, []); map.get(file).push(line); };
  const where = (end) => ({
    index: end.index, role: end.role,
    file: typeof end.raw?.file === 'string' ? end.raw.file : null,
    line: Number.isInteger(end.raw?.line) ? end.raw.line : null,
  });
  for (const end of ends) {
    const result = checkEnd({ end, readLines, areaFiles, entryPoints });
    if (result.ok) {
      at(ended, result.end.file, result.end.line);
      for (const e of result.end.evidence) at(evidence, e.file, e.line);
    } else if (typeof end.raw?.file === 'string' && insideRoot(end.raw.file) !== null) {
      at(rejectedAt, insideRoot(end.raw.file), end.raw.line);
    }
    if (result.ok) {
      if (end.kind !== 'external') continue;
      if (result.end.hostNotQuoted) notices.push({ ...where(end), notice: 'host-not-quoted', detail: `no cited line holds ${result.normalized.address?.host ?? 'the host'}` });
      if (!result.normalized.ok && result.normalized.transport) notices.push({ ...where(end), notice: 'transport-name', detail: result.normalized.reason });
      continue;
    }
    rejected.push({ ...where(end), rejection: result.rejection, detail: result.detail });
  }
  const lineSkips = new Map();
  for (const s of skippedLines) if (areaFiles.has(s.file)) { if (!lineSkips.has(s.file)) lineSkips.set(s.file, []); lineSkips.get(s.file).push(s); }
  const callLines = (context.files ?? []).flatMap((f) => (Array.isArray(f.callLines) ? f.callLines : [])
    .map((c) => ({ file: f.file, line: c.line, to: c.to ?? c.line, signal: c.signal, text: c.text })));
  const accounted = accountCallLines({
    callLines, ended, evidence, rejected: rejectedAt, skippedLines: lineSkips,
    skippedFiles: new Set(skipped.filter((s) => areaFiles.has(s.file)).map((s) => s.file)),
  });
  const unaccounted = accounted.rows.map((row, i) => ({ row, call: callLines[i] })).filter(({ row }) => row.status === 'unaccounted')
    .map(({ call }) => ({ file: call.file, line: call.line, signal: call.signal ?? null, text: call.text ?? '' }));
  return { status: 'accepted', ends: ends.length, accepted: ends.length - rejected.length, rejected, notices, callLines: callLines.length, unaccounted };
}

export function reportLines(areaId, result) {
  if (result.status !== 'accepted') return [`check ${areaId}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`];
  return [
    `check ${areaId}: ends=${result.ends} accepted=${result.accepted} rejected=${result.rejected.length}${result.notices.length > 0 ? ` notices=${result.notices.length}` : ''}`
      + (result.callLines > 0 ? ` call-lines=${result.callLines} unaccounted=${result.unaccounted.length}` : ''),
    ...result.rejected.map((r) => `rejected relations[${r.index}].${r.role} ${r.file ?? '?'}:${r.line ?? '?'} ${r.rejection}: ${r.detail}`),
    ...result.notices.map((r) => `notice relations[${r.index}].${r.role} ${r.file ?? '?'}:${r.line ?? '?'} ${r.notice}: ${r.detail}`),
    ...result.unaccounted.map((u) => `unaccounted ${u.file}:${u.line} ${u.signal ?? '-'}: ${u.text}`),
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
  return result.rejected.length > 0 || result.unaccounted.length > 0 ? 1 : 0;
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
