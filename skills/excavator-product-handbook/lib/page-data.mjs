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
import { architectureOf, domainsData, leadOf, searchIndex } from './page-domains.mjs';
import { problemsData } from './page-problems.mjs';
import { processesData } from './page-processes.mjs';
import { historyPageSection, historyPlaces } from './history-page.mjs';
import { languageTag } from './language-tag.mjs';
import { coverageLines } from './md-coverage.mjs';
import { TECHNICAL_ONLY_BLOCKS, historyOf, scriptBlockNames } from './md-blocks.mjs';
import { renderedChapter } from './chapter-render.mjs';
import { chapterMarkdown, chapterTitle } from './md-views.mjs';
import { directorySides, markServerSteps } from './step-sides.mjs';
import { resolveOutlineV2 } from './outline-v2.mjs';
import { withoutRootPaths } from './root-paths.mjs';
import { DEFAULT_VIEWS } from './views.mjs';

/**
 * Format /23 (openspec change handbook-process-review, design D10), the business processes and the remedies of each problem:
 * - `processes`: null when the run has no business-processes chapter (no file, or one that did not pass its check) or the outline leaves it
 *   out; otherwise `{ items, coverage }` (page-processes.mjs). An item is `{ id, name, steps, end?, features }`: `id` is `P<n>` as item-numbers.mjs
 *   numbers it, a step is `{ role, operation, feature, text, cites? }` (`feature` a feature id; `text` the sentence without citations; `cites` the
 *   citations of the sentence, only with the technical view), `end` is `{ text, cites? }` (absent without an end-state line) and `features` the
 *   feature ids of the steps in step order, each once. `coverage` is `[{ feature, operations }]`: the operations of each feature that no step names.
 * - `problems.rows`: a design row has `process` (`P<n>`) when its item names a process, and every row has `remedies` in place of /22's `remedy`:
 *   `[{ heading, anchor }]`, one per list item or paragraph of the remedies chapter whose id group names the row (in chapter order; `heading` is the title
 *   of its level-2 section, `anchor` the id the remedies page puts on the item), `[]` when none does and for an open question. A remedies chapter that
 *   names no id gives the one level-2 heading that names the category or dimension, with its page heading id `h-<n>` as the anchor.
 * (/22 and older below.)
 *
 * Format /22 (earlier formats below; openspec change handbook-skill-first, design D7), the Markdown chapters:
 * - `titles`: the title of each selected view (`md.title`, `md.titleTechnical`).
 * - `outline`: `source` and `problems` as `resolveOutlineV2` gives them, `parts` as `{ title, blocks: [{ block, kind, title }] }` (`kind` is `chapter`,
 *   `data`, `dictionaries` or `history`; a chapter's title is its first level-1 heading, else its name) and `unplaced` as `{ block, reason }`.
 * - `chapters`: one `{ id, texts }` per chapter block the outline places, in outline order; `texts` maps each selected view to the chapter's Markdown.
 * - `coverage`: the coverage section as Markdown (its title a level-1 heading), by selected view.
 * - `history`: the code health as the page draws it (history-page.mjs), or null when the run has none or the outline leaves it out.
 * - `technical`, only with the technical view: `data` and `dictionaries` with their state (`ok`, `missing`, `malformed`) and `history`, the paths
 *   of the hotspot files and of the files changed together (null without a history).
 * - `domains`: the business domains and their hand-overs from the checked domains.json (page-domains.mjs): `state` is `ok`, `missing`,
 *   `failed` or `changed`, `list` is `{ id, name, features, intro, body }` (ids `d1`..., `intro` the first paragraph of the domain's section of the
 *   domains chapter, `body` the rest, each by selected view) and `handovers` is `{ from, to, what, features, cites? }` (domain ids; `cites` only with the technical view).
 * - `problems` (/22, openspec change handbook-page-structure): `{ sources, rows, remedies }` (page-problems.mjs);
 *   `sources` is `{ defects, design, open }` each `{ state, count }` (`state` `ok`, `missing`, `failed` or `changed`, `count` null unless `ok`; `open` also has `unmatched`, the stems of the system or feature chapters with no heading equal to the fixed open-questions text, which gave no rows), `rows` the defects,
 *   then the design problems, then the open questions as `{ id, type, level, group, features, summary, texts, cites?, source, remedy }`, `remedies` the id of the remedies chapter or null.
 * - `lead`: the first paragraph of the system chapter in the product view's text; `search`: the search index, `{ kind, title, chapter, domain, heading }` for each domain,
 *   chapter and `##` or `###` heading of a chapter (`heading` counts them from 0 in each chapter, `level` is 2 or 3; null on the other items).
 * - `architecture` (/21): the section of the system chapter that holds its first mermaid fence, by selected view (page-domains.mjs); '' without one.
 * (/21: the same without `problems`; /20: the same without `architecture` and without `level` in the search items; /19: the same without these three keys; /18 and older: the structured handbook of openspec change product-handbook-map and its successors.)
 */
export const PAGE_FORMAT = 'excavator-product-handbook-page/23';

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
  // The server steps of each feature's operations are marked from their citations, for the page to fold (design D22).
  const featureIds = new Set(run.map.features.map((feature) => feature.id));
  const marks = { sides: directorySides(run.candidates), operations: t('chapter.section.operations'), marker: t('chapter.serverSteps') };
  const forPage = (block) => {
    const chapter = renderedChapter(run, block);
    return featureIds.has(block) ? { ...chapter, text: markServerSteps(chapter.text, marks) } : chapter;
  };
  const chapters = parts.flatMap((part) => part.blocks).filter((item) => item.kind === 'chapter').map((item) => ({
    id: item.block,
    texts: Object.fromEntries(views.map((view) => [view, chapterMarkdown(forPage(item.block), view, run.ui)])),
  }));
  // The page shows one chapter at a time, so the section's own title is its level-1 heading, like a chapter's.
  const coverage = trimmed(coverageLines({ map: run.map, candidates: run.candidates, chapters: run.chapters, outline, t }).map((line) => (/^#{2,6} /.test(line) ? line.slice(1) : line)));
  const history = scripts.includes('history') && placed.has('history') ? historyOf(run, roots[0]) : null;
  const domains = domainsData(run, views);
  const processes = processesData(run, views, { placed: placed.has('processes'), domains });
  // The processes with suggestions are the ones whose section the remedies page folds into a list of links.
  const processIds = new Set((processes?.items ?? []).filter((item) => item.remedies !== undefined).map((item) => item.id));
  const chapterBlocks = parts.flatMap((part) => part.blocks).filter((item) => item.kind === 'chapter');
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
    domains,
    problems: problemsData(run, views, { processIds }),
    processes,
    lead: leadOf(run),
    architecture: architectureOf(run, views),
    search: searchIndex(domains, chapterBlocks, run, { processIds }),
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
