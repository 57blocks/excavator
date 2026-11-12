/**
 * `handbook.mjs assemble <out> --project <root> [--views <list>]`: write the handbook of each
 * selected view from the Markdown chapters under `<out>/chapters/`: `<out>/handbook.md` for the
 * product view (citations removed) and `<out>/handbook-technical.md` for the technical view
 * (chapters as written). Every chapter must carry a record in state.json (format /2) of its
 * present bytes, or nothing is written. Chapters go in the order of `outline.json` (format /2)
 * or, when it breaks conservation, the default order, with each break printed as an `Outline:`
 * line. The data, status dictionary and code health the scripts wrote are rendered as before;
 * the coverage section is last. The file of a view that was not selected is removed.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { loadDataSection } from './data-section.mjs';
import { loadDictionariesSection } from './dict-section.mjs';
import { writeTextAtomic } from './json-file.mjs';
import { coverageLines } from './md-coverage.mjs';
import { TECHNICAL_ONLY_BLOCKS, historyOf, scriptBlockNames } from './md-blocks.mjs';
import { loadMdRun } from './md-run.mjs';
import { chapterMarkdown } from './md-views.mjs';
import { dataBlock } from './render-data.mjs';
import { dictionaryBlock } from './render-dict.mjs';
import { historyChapter } from './render-history.mjs';
import { shiftHeadings } from './render-outline.mjs';
import { SCRIPT_BLOCKS, resolveOutlineV2 } from './outline-v2.mjs';
import { DEFAULT_VIEWS, VIEWS } from './views.mjs';

export const HANDBOOK_FILE = 'handbook.md';
export const TECHNICAL_HANDBOOK_FILE = 'handbook-technical.md';
/** The file each view is written to. */
export const HANDBOOK_FILES = Object.freeze({ product: HANDBOOK_FILE, technical: TECHNICAL_HANDBOOK_FILE });

/** The script-written blocks that exist: `{ name, lines(view) }`; data and dictionaries are technical-only, the code health is in both views. */
function scriptBlocks(run, root) {
  const t = (key) => run.ui[key];
  const lines = {
    data: () => dataBlock(loadDataSection(run.outDir), t),
    dictionaries: () => shiftHeadings(dictionaryBlock(loadDictionariesSection(run.outDir), t), -1),
    history: (view) => historyChapter({ history: historyOf(run, root), map: run.map, view, t }),
  };
  return new Map(scriptBlockNames(run).map((name) => [name, { technical: TECHNICAL_ONLY_BLOCKS.includes(name), lines: lines[name] }]));
}

/** One chapter in a view, its headings one level down so the handbook title is the only level-1 heading. */
function chapterText(run, name, view) {
  const text = chapterMarkdown(run.chapters.get(name), view, run.ui);
  return shiftHeadings(text.split('\n'), 1).join('\n').replace(/\s+$/, '');
}

/** Returns { status, lines }; on success the lines are the `Outline:` problems, then the paths written, one per view in the fixed order. */
export function assemble(outDirArg, root, { views = DEFAULT_VIEWS } = {}) {
  const run = loadMdRun(outDirArg, root);
  if (!run.ok) return { status: 1, lines: run.lines };
  const t = (key) => run.ui[key];
  const scripts = scriptBlocks(run, root);
  const blocks = [...run.chapters.keys(), ...SCRIPT_BLOCKS.filter((name) => scripts.has(name))];
  const outline = resolveOutlineV2(run.outDir, { blocks, featureIds: run.map.features.map((feature) => feature.id), t });
  const coverage = coverageLines({ map: run.map, candidates: run.candidates, chapters: run.chapters, outline, t });
  const rendered = views.map((view) => {
    const technical = view === 'technical';
    const parts = [`# ${t(technical ? 'md.titleTechnical' : 'md.title')}`];
    for (const part of outline.parts) {
      for (const block of part.chapters) {
        if (run.chapters.has(block)) parts.push(chapterText(run, block, view));
        else if (scripts.has(block) && (technical || !scripts.get(block).technical)) {
          const lines = scripts.get(block).lines(view);
          if (lines.length > 0) parts.push(lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd());
        }
      }
    }
    parts.push(coverage.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd());
    return [view, `${parts.join('\n\n')}\n`];
  });
  for (const view of VIEWS) if (!views.includes(view)) rmSync(join(run.outDir, HANDBOOK_FILES[view]), { force: true });
  const lines = [...outline.problems];
  for (const [view, text] of rendered) {
    const path = join(run.outDir, HANDBOOK_FILES[view]);
    writeTextAtomic(path, text);
    lines.push(path);
  }
  return { status: 0, lines };
}
