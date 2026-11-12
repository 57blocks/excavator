/**
 * `handbook.mjs remedy-judge <out> --project <root>` (openspec change
 * handbook-remedies, design D5): for remedies that passed check-remedies, write
 * the judge file `<out>/remedies/judge.json` and print where each of the two
 * judges reads and writes. The judge file holds, for each paragraph (a category's
 * cause and measure, or a recommendation), its text and everything it cites: the
 * fact lines (a group's level and statement, an application's figures, the shared
 * tables, the counts). It holds no code, no other group and nothing else. The two
 * judges do not see each other, each with its own verdict file
 * `<out>/remedies/verdicts/<a|b>.json`. Older judge and verdict files are cleared
 * first. Changes only files under `<out>/remedies`.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readJson, writeJson } from './json-file.mjs';
import { loadRemediesContext } from './remedies-context.mjs';
import { JUDGES, REMEDIES_DIR, REMEDIES_FILE, judgeFilePath, judgeVerdictPath, paragraphsOf, remediesShapeProblems } from './remedies-shape.mjs';
import { entryDigest } from './state.mjs';

/**
 * The remedies of a context that passed check-remedies, or the lines that stop a judge command: the unit must be `checked`
 * for the facts of today, and the file must be the one that was checked. Returns `{ stop }` or `{ doc }`.
 */
export function checkedRemedies(context) {
  const { entry, facts, outDir } = context;
  const rerun = 'Next: run remedy-facts, write the remedies, then run check-remedies';
  if (entry.status !== 'checked') return { stop: { status: 1, lines: [`remedies: is ${entry.status}; only checked remedies are judged`, rerun] } };
  if (entry.factsDigest !== facts.digest) return { stop: { status: 1, lines: ['remedies: the facts changed after the remedies were checked', rerun] } };
  const path = join(outDir, REMEDIES_FILE);
  const read = readJson(path);
  if (!read.ok || remediesShapeProblems(read.value).length > 0 || entryDigest(path) !== entry.entryDigest) {
    return { stop: { status: 1, lines: [`remedies: ${REMEDIES_FILE} changed after it was checked`, rerun] } };
  }
  return { doc: read.value };
}

/** What a judge reads of a cited fact: a group's own line without its key, any other fact with its name. */
const contentOf = (row) => (row.kind === 'group' ? row.fields : [row.id, ...row.fields]).join(' | ');

/** The judge file: `{ unit, items: [{ id, kind, cause, measure | title, text, cites: [{ id, content }] }] }`. */
export function judgeFile(doc, facts) {
  return {
    unit: 'remedies',
    items: paragraphsOf(doc).map((paragraph) => ({
      id: paragraph.id,
      kind: paragraph.kind,
      ...(paragraph.kind === 'category' ? { cause: paragraph.cause, measure: paragraph.measure } : { title: paragraph.title, text: paragraph.text }),
      cites: paragraph.cites.map((id) => ({ id, content: contentOf(facts.byId.get(id)) })),
    })),
  };
}

/** Run remedy-judge. Returns { status, lines }. */
export function remedyJudge(outDirArg, root) {
  const context = loadRemediesContext(outDirArg, root);
  if (context.stop) return context.stop;
  if (!context.hasGroups) return { status: 0, lines: ['Remedies: no verified findings; nothing to judge'] };
  const checked = checkedRemedies(context);
  if (checked.stop) return checked.stop;
  const { outDir, facts } = context;
  rmSync(join(outDir, REMEDIES_DIR), { recursive: true, force: true });
  const path = judgeFilePath(outDir);
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(dirname(judgeVerdictPath(outDir, 'a')), { recursive: true });
  writeJson(path, judgeFile(checked.doc, facts));
  return {
    status: 0,
    lines: [
      `remedies: ${checked.doc.categories.length} categories and ${checked.doc.recommendations.length} recommendations`,
      `Judge file: ${path} | Verdict files: ${JUDGES.map((letter) => judgeVerdictPath(outDir, letter)).join(' ')}`,
      'Next: dispatch two excavator-handbook-remedy-judge subagents, one for each verdict file, then run remedy-verdicts',
    ],
  };
}
