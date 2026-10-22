#!/usr/bin/env node
/**
 * score.mjs — scores the reviewer agent's findings on the eval cases
 * (openspec change review-eval, design D4).
 *
 * Usage:
 *   node scripts/review-eval/score.mjs <cases.json> <results-dir>
 *
 * cases.json holds {"cases": [...]}. Each case has an `id`, the git `range`
 * the reviewer reads and a list of `defects`; a case with no defects is a
 * clean case. Each defect has an `id` and one or more `spans`, {path, start,
 * end}: the 1-based lines in the range's head where the defect sits.
 *
 * <results-dir>/<case id>.json is the reviewer's output for one case: a JSON
 * array of findings, each with `severity` (Important, Nit or Pre-existing),
 * `path`, `line`, `title` and `body`, as the reviewer prints them for a range.
 *
 * A defect is hit when an Important finding on one of its paths has its line
 * inside a span, or at most MARGIN lines outside it. A finding counts for one
 * defect at most: findings and defects are paired nearest first, ties going
 * to the earlier finding, then the earlier defect. A defect that is not hit
 * is seen at the wrong severity when a Nit or Pre-existing finding falls in
 * the same lines, and missed otherwise.
 *
 * Prints one block per case, then the totals: recall, the Important findings
 * on no known defect in the defect cases, and the Important and Nit findings
 * on the clean cases.
 * Exit code: 0 when every case has a result that can be read; 1 when a case
 * has no result file or its result cannot be read, since a partial run is
 * not a score; 2 when the arguments or cases.json are invalid.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MARGIN = 3;
const SEVERITIES = ['Important', 'Nit', 'Pre-existing'];
// Case ids name the result files, so they cannot hold a path separator.
const ID = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  process.stderr.write(`score: ${message}\n`);
  process.exit(2);
}

function isLine(value) {
  return Number.isInteger(value) && value >= 1;
}

function readCases(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (error) {
    fail(`cannot read ${file}: ${error.message}`);
  }
  const cases = parsed?.cases;
  if (!Array.isArray(cases) || cases.length === 0) fail(`${file} holds no cases`);
  const ids = new Set();
  const claim = (id, what) => {
    if (typeof id !== 'string' || !ID.test(id)) fail(`a ${what} has no valid id`);
    if (ids.has(id)) fail(`the id ${id} appears twice`);
    ids.add(id);
  };
  for (const item of cases) {
    claim(item?.id, 'case');
    if (typeof item.range !== 'string' || !item.range.includes('..')) fail(`case ${item.id} has no range`);
    if (!Array.isArray(item.defects)) fail(`case ${item.id} has no defects list`);
    for (const defect of item.defects) {
      claim(defect?.id, 'defect');
      if (!Array.isArray(defect.spans) || defect.spans.length === 0) fail(`defect ${defect.id} has no spans`);
      for (const span of defect.spans) {
        if (typeof span?.path !== 'string' || !isLine(span.start) || !isLine(span.end) || span.end < span.start) {
          fail(`defect ${defect.id} has an invalid span`);
        }
      }
    }
  }
  return cases;
}

function readResult(dir, id) {
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) return { state: 'not run' };
  let findings;
  try {
    findings = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { state: 'unreadable', reason: 'not JSON' };
  }
  if (!Array.isArray(findings)) return { state: 'unreadable', reason: 'not an array' };
  for (const [index, finding] of findings.entries()) {
    const valid = SEVERITIES.includes(finding?.severity) && typeof finding.path === 'string' && isLine(finding.line)
      && typeof finding.title === 'string' && typeof finding.body === 'string';
    if (!valid) return { state: 'unreadable', reason: `finding ${index + 1} lacks a known severity, path, line, title or body` };
  }
  return { state: 'read', findings };
}

// Lines between a finding and the nearest span of a defect on the same path:
// 0 inside a span, Infinity when no span is on that path.
function distance(finding, defect) {
  let nearest = Infinity;
  for (const span of defect.spans) {
    if (span.path !== finding.path) continue;
    const gap = finding.line < span.start ? span.start - finding.line : Math.max(0, finding.line - span.end);
    nearest = Math.min(nearest, gap);
  }
  return nearest;
}

// Pairs Important findings with defects in range, each finding with one
// defect at most, so that as many defects as possible are hit: a maximum
// matching by augmenting paths. Findings take their turn in result order and
// try the defects in range nearest first, the earlier defect on a tie, so a
// lone finding in an overlap goes to the nearer defect.
function scoreCase(defects, findings) {
  const near = findings.map((finding) => {
    if (finding.severity !== 'Important') return [];
    return defects
      .map((defect, d) => ({ d, gap: distance(finding, defect) }))
      .filter(({ gap }) => gap <= MARGIN)
      .sort((a, b) => a.gap - b.gap || a.d - b.d)
      .map(({ d }) => d);
  });
  const owner = defects.map(() => -1);
  const place = (f, tried) => near[f].some((d) => {
    if (tried.has(d)) return false;
    tried.add(d);
    if (owner[d] !== -1 && !place(owner[d], tried)) return false;
    owner[d] = f;
    return true;
  });
  let paired = 0;
  findings.forEach((_, f) => {
    if (place(f, new Set())) paired += 1;
  });
  const buckets = defects.map((defect, d) => {
    if (owner[d] !== -1) return 'hit';
    const seen = findings.some((finding) => finding.severity !== 'Important' && distance(finding, defect) <= MARGIN);
    return seen ? 'wrong severity' : 'missed';
  });
  const important = findings.filter((finding) => finding.severity === 'Important').length;
  return { buckets, unpaired: important - paired };
}

const [casesFile, resultsDir, ...rest] = process.argv.slice(2);
if (!casesFile || !resultsDir || rest.length > 0) fail('usage: score.mjs <cases.json> <results-dir>');
if (!existsSync(resultsDir) || !statSync(resultsDir).isDirectory()) fail(`${resultsDir} is not a directory`);

const cases = readCases(casesFile);
const defects = { hit: 0, 'wrong severity': 0, missed: 0, 'not scored': 0 };
const states = { 'not run': 0, unreadable: 0 };
let unpaired = 0;
const clean = { Important: 0, Nit: 0 };
const lines = [];

for (const item of cases) {
  const result = readResult(resultsDir, item.id);
  if (result.state !== 'read') {
    states[result.state] += 1;
    lines.push(`${item.id}  ${result.state}${result.reason ? `: ${result.reason}` : ''}`);
    for (const defect of item.defects) {
      defects['not scored'] += 1;
      lines.push(`  not scored      ${defect.id}`);
    }
    continue;
  }
  const count = (severity) => result.findings.filter((finding) => finding.severity === severity).length;
  lines.push(`${item.id}  ${SEVERITIES.map((severity) => `${severity} ${count(severity)}`).join(', ')}`);
  if (item.defects.length === 0) {
    clean.Important += count('Important');
    clean.Nit += count('Nit');
    continue;
  }
  const scored = scoreCase(item.defects, result.findings);
  unpaired += scored.unpaired;
  item.defects.forEach((defect, d) => {
    defects[scored.buckets[d]] += 1;
    lines.push(`  ${scored.buckets[d].padEnd(16)}${defect.id}`);
  });
}

const total = cases.reduce((sum, item) => sum + item.defects.length, 0);
lines.push('');
lines.push(`recall: ${defects.hit}/${total} defects hit`);
lines.push(`defects: ${Object.entries(defects).map(([bucket, n]) => `${bucket} ${n}`).join(', ')}`);
lines.push(`defect cases: Important on no known defect ${unpaired}`);
lines.push(`clean cases: Important ${clean.Important}, Nit ${clean.Nit}`);
lines.push(`cases: ${cases.length}, not run ${states['not run']}, unreadable ${states.unreadable}`);
process.stdout.write(`${lines.join('\n')}\n`);
process.exit(states['not run'] + states.unreadable > 0 ? 1 : 0);
