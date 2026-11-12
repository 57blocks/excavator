/**
 * `prd.mjs reply <out>` (openspec change prd-feature-pipeline, design D9):
 * the skill's reply, printed by the script so the model copies lines rather
 * than filling a template. It reads the statuses and counts the last
 * `aggregate` recorded in index.json, through the same summary aggregate
 * prints, and writes nothing. The second line is the report page: its path
 * when `<out>/report.html` exists, else `Report page: not written`, never
 * left out (change prd-report-page, design D8). The findings line ends with
 * the findings counted by level, `<n> P0, <n> P1, <n> P2, <n> unranked`, from
 * the totals aggregate recorded (change prd-report-finding-priority, design
 * D7); an index.json from before priorities counts them all as unranked.
 * The retry line, `Retry: <ids> failed after one attempt; ...`, comes right
 * after the counts and only when `retryable` is not empty (change
 * prd-report-prd-shape, design D6). The frameworks without patterns are a
 * line only when there are some; the offer to save the PRD is a line only
 * when <out> is the default `<root>/.excavator/prd-report`, naming `docs/PRD.md`, or
 * `docs/PRD-<scope>.md` for a scoped run.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PRD_FILE, summarize } from './aggregate.mjs';
import { loadIndex, schemaProblems } from './index-check.mjs';
import { PAGE_FILE } from './page.mjs';
import { projectRootProblem } from './project-root.mjs';

/** Where the offer says the PRD goes: docs/PRD.md, or docs/PRD-<scope>.md with the scope's path joined by dashes. */
export function defaultSavePath(scope) {
  const name = typeof scope === 'string' ? scope.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') : '';
  return name === '' ? 'docs/PRD.md' : `docs/PRD-${name}.md`;
}

/** Run reply on `<out>`. Returns { status, lines }. */
export function reply(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const read = loadIndex(outDir);
  if (!read.ok) return { status: 1, lines: [read.line] };
  const schema = schemaProblems(read.value);
  if (schema.length > 0) return { status: 1, lines: schema };
  const index = read.value;
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) return { status: 1, lines: [rootProblem] };
  if (!existsSync(join(outDir, PRD_FILE))) return { status: 1, lines: [`${PRD_FILE}: missing; run assemble first`] };

  const s = summarize(outDir, index, root);
  const v = s.verification;
  const p = s.findings.priority;
  const lines = [
    s.prdPath,
    // Never left out: the path when `page` wrote report.html, else the words that say it did not.
    existsSync(join(outDir, PAGE_FILE)) ? `Report page: ${join(outDir, PAGE_FILE)}` : 'Report page: not written',
    `${s.features.written}/${s.features.total} features written, ${s.features.failed} failed`,
    `${s.diagrams} diagrams`,
    // The levels are the totals aggregate recorded (change prd-report-finding-priority, design D7), never added up by the model.
    `${s.findings.product} product, ${s.findings.technical} technical findings, anchors checked: ${p.P0} P0, ${p.P1} P1, ${p.P2} P2, ${p.unranked} unranked`,
    `Statements: ${v.verified} verified, ${v.contradicted} contradicted, ${v.misattributed} misattributed, ${v.unverifiable} unverifiable; `
      + `open items: ${v.resolvedRight} resolved right, ${v.resolvedWrong} resolved wrong, ${v.stillOpen} still open; `
      + `cross-section conflicts: ${v.conflicts}, not checked: ${v.notChecked}`,
  ];
  // The failed features a second run still repairs (change prd-report-prd-shape, design D6): right after the counts.
  if (s.retryable.length > 0) lines.push(`Retry: ${s.retryable.join(' ')} failed after one attempt; running the command again without --fresh retries them`);
  if (s.uncovered.length > 0) lines.push(`No entrypoint patterns for: ${s.uncovered.join(', ')}`);
  if (s.outIsDefault) {
    lines.push(`To save it in the project, say so: it goes to ${defaultSavePath(index.scope)} unless you give another path. Commit it to share it with the team.`);
  }
  return { status: 0, lines };
}
