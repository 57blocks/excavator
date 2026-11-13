/**
 * The features that cite each file, for the "features" column of the hotspot table: the ids of the
 * feature chapters (`chapters/F<n>.md`) that state.json (format /2) records, whatever their
 * status, and that cite a line of the file. Read from the output directory only, with no check of
 * the project: a run with no feature chapter yet (the history section run first) names none.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { citationGroups, parseSpec } from './chapter-cites.mjs';
import { loadStateV2 } from './state-v2.mjs';

const FEATURE_CHAPTER = /^(F\d+)\.md$/;

/** The project-relative files the citation groups of a chapter text cite. */
export function citedFiles(text) {
  const files = new Set();
  for (const group of citationGroups(text)) {
    for (const spec of group.specs) {
      const parsed = parseSpec(spec);
      if (parsed.file !== undefined) files.add(parsed.file);
    }
  }
  return files;
}

/** A Map from a project-relative path to the ids of the recorded feature chapters that cite it, in feature-number order. */
export function featuresByFile(outDir) {
  const byFile = new Map();
  const loaded = loadStateV2(outDir);
  const dir = join(outDir, 'chapters');
  if (!loaded.ok || !existsSync(dir)) return byFile;
  const ids = readdirSync(dir)
    .map((name) => FEATURE_CHAPTER.exec(name)?.[1])
    .filter((id) => id !== undefined && loaded.state.chapters[id] !== undefined)
    .sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  for (const id of ids) {
    for (const file of citedFiles(readFileSync(join(dir, `${id}.md`), 'utf-8'))) byFile.set(file, [...(byFile.get(file) ?? []), id]);
  }
  return byFile;
}
