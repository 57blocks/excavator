/**
 * The data of the handbook page, built from a loaded Markdown run (md-run.mjs): one object with its
 * keys in a fixed order, no time and no machine path, so the same run gives the same object. The
 * page shows the chapters as Markdown, so the data is mostly their text, made by the functions
 * `assemble` uses (md-views.mjs): the product view's text has every citation taken out, and a view
 * that was not selected has no text at all. The scripts' blocks (data, status dictionaries, code
 * health) stay structured, as the page draws them with its own components.
 */

import { basename } from 'node:path';

import { loadDataSection, pageSection } from './data-section.mjs';
import { dictionariesPageSection, loadDictionariesSection } from './dict-section.mjs';
import { historyPageSection, historyPlaces } from './history-page.mjs';
import { languageTag } from './language-tag.mjs';
import { coverageLines } from './md-coverage.mjs';
import { TECHNICAL_ONLY_BLOCKS, historyOf, scriptBlockNames } from './md-blocks.mjs';
import { chapterMarkdown, chapterTitle } from './md-views.mjs';
import { resolveOutlineV2 } from './outline-v2.mjs';
import { withoutRootPaths } from './root-paths.mjs';
import { DEFAULT_VIEWS } from './views.mjs';

/**
 * Format /19 (openspec change handbook-skill-first, design D7), the Markdown chapters:
 * - `titles`: the title of each selected view (`md.title`, `md.titleTechnical`).
 * - `outline`: `source` and `problems` as `resolveOutlineV2` gives them, `parts` as `{ title, blocks: [{ block, kind, title }] }` (`kind` is `chapter`,
 *   `data`, `dictionaries` or `history`; a chapter's title is its first level-1 heading, else its name) and `unplaced` as `{ block, reason }`.
 * - `chapters`: one `{ id, texts }` per chapter block the outline places, in outline order; `texts` maps each selected view to the chapter's Markdown.
 * - `coverage`: the coverage section as Markdown (its title a level-1 heading), by selected view.
 * - `history`: the code health as the page draws it (history-page.mjs), or null when the run has none or the outline leaves it out.
 * - `technical`, only with the technical view: `data` and `dictionaries` with their state (`ok`, `missing`, `malformed`) and `history`, the paths
 *   of the hotspot files and of the files changed together (null without a history).
 * (/18 and older: the structured handbook of openspec change product-handbook-map and its successors.)
 */
export const PAGE_FORMAT = 'excavator-product-handbook-page/19';

const SCRIPT_TITLES = { data: 'md.data.heading', dictionaries: 'md.dict.heading', history: 'md.history.heading' };
const trimmed = (lines) => lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();

/**
 * The page data of a loaded run (`loadMdRun`'s result). `roots` are the paths of the project, each replaced by the project's directory name in
 * every string; the first is the real path. `views` are the views the page has (views.mjs).
 */
export function buildPageData(run, roots, { views = DEFAULT_VIEWS } = {}) {
  const t = (key) => run.ui[key];
  const technical = views.includes('technical');
  const scripts = scriptBlockNames(run);
  const outline = resolveOutlineV2(run.outDir, { blocks: [...run.chapters.keys(), ...scripts], featureIds: run.map.features.map((feature) => feature.id), t });
  const placed = new Set(outline.parts.flatMap((part) => part.chapters));
  const parts = outline.parts.map((part) => ({
    title: part.title,
    blocks: part.chapters.map((block) => (run.chapters.has(block)
      ? { block, kind: 'chapter', title: chapterTitle(run.chapters.get(block).text, block) }
      : { block, kind: block, title: t(SCRIPT_TITLES[block]) })),
  }));
  const chapters = parts.flatMap((part) => part.blocks).filter((item) => item.kind === 'chapter').map((item) => ({
    id: item.block,
    texts: Object.fromEntries(views.map((view) => [view, chapterMarkdown(run.chapters.get(item.block), view, run.ui)])),
  }));
  // The page shows one chapter at a time, so the section's own title is its level-1 heading, like a chapter's.
  const coverage = trimmed(coverageLines({ map: run.map, candidates: run.candidates, chapters: run.chapters, outline, t }).map((line) => (/^#{2,6} /.test(line) ? line.slice(1) : line)));
  const history = scripts.includes('history') && placed.has('history') ? historyOf(run, roots[0]) : null;
  const data = {
    format: PAGE_FORMAT,
    chunks: { parts: [], units: {} },
    language: run.map.language,
    languageTag: languageTag(run.map.language),
    ui: { strings: run.ui },
    views: [...views],
    titles: Object.fromEntries(views.map((view) => [view, t(view === 'technical' ? 'md.titleTechnical' : 'md.title')])),
    outline: { source: outline.source, problems: outline.problems, parts, unplaced: outline.unplaced.map((item) => ({ block: item.block, reason: item.reason })) },
    chapters,
    coverage: Object.fromEntries(views.map((view) => [view, coverage])),
    history: history === null ? null : historyPageSection(history),
  };
  if (technical) {
    const wanted = (name) => TECHNICAL_ONLY_BLOCKS.includes(name) && scripts.includes(name) && placed.has(name);
    const dataSection = wanted('data') ? loadDataSection(run.outDir) : { state: 'missing' };
    const dictionaries = wanted('dictionaries') ? loadDictionariesSection(run.outDir) : { state: 'missing' };
    data.technical = {
      data: dataSection.state === 'ok' ? pageSection(dataSection.data) : null,
      dataState: dataSection.state,
      dictionaries: dictionaries.state === 'ok' ? dictionariesPageSection(dictionaries.data) : null,
      dictionariesState: dictionaries.state,
      history: history === null ? null : historyPlaces(history),
    };
  }
  return withoutRootPaths(data, roots, basename(roots[0]));
}
