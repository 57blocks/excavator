/**
 * The verified features that cite each file (openspec change
 * handbook-history-appendix, design D2): for the hotspot table, the ids of the
 * features whose verified entry holds a citation in the file. Read from
 * state.json and the entry files of the output directory, with no check of the
 * project and no map: a run that has none (the history section run first) has no
 * feature to name. A feature counts only while its state is `verified`, or `checked` with a chapter (a /3 entry); the
 * assembly checks the entries again and lists only the features still verified.
 */

import { join } from 'node:path';

import { isObject, readJson } from './json-file.mjs';
import { loadState } from './state.mjs';

/** The files cited anywhere in a parsed entry: every `evidence` list of `{ file }`, at any depth. */
export function citedFiles(value, into = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) citedFiles(item, into);
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'evidence' && Array.isArray(child)) {
        for (const citation of child) if (isObject(citation) && typeof citation.file === 'string') into.add(citation.file);
      } else {
        citedFiles(child, into);
      }
    }
  }
  return into;
}

/** A Map from a project-relative path to the ids of the verified features that cite it, in the order of state.json. */
export function featuresByFile(outDir) {
  const loaded = loadState(outDir);
  const byFile = new Map();
  if (!loaded.ok) return byFile;
  for (const [id, entry] of Object.entries(loaded.state.features)) {
    // A checked /3 entry (a chapter, written and not verified) is in the output as well (openspec change handbook-light-scheme); a checked entry without a chapter is not.
    if (entry.status !== 'verified' && !(entry.status === 'checked' && entry.chapter !== undefined && !entry.rewriting)) continue;
    const read = readJson(join(outDir, 'entries', `${id}.json`));
    if (!read.ok) continue;
    for (const file of citedFiles(read.value)) byFile.set(file, [...(byFile.get(file) ?? []), id]);
  }
  return byFile;
}
