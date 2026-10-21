/**
 * The product overlays of the graph (openspec: changes/viewer-app, design D3 and
 * D8; spec "Product overlays"). What each overlay marks, read off the product's
 * own records and nothing else:
 *   hotspots  files by the band of their score; the bands are the quartiles of
 *             the scores the product lists, so they follow its own distribution;
 *   unused    the functions the unused-code product lists, and the files that
 *             hold them, by the product's confidence;
 *   doc-map   the files of the doc map's coverage, with and without evidence.
 * A directory, layer or fold has no record of its own here: it takes what its
 * files have (the highest band, the count of listed functions, how many files
 * have evidence), and its tooltip says so.
 * Every sentence states a number or a fact; none advises.
 */

import type { GraphIndex } from '../data/indexes';
import { mapUnused } from '../data/product-mapping';
import { formatNumber, EN_DASH } from './format';
import type { FileInfo } from './graph-structure';
import { OVERLAY_NAMES as OVERLAYS_IN_ORDER, OVERLAYS, type OverlayName } from './overlay-names';

type Json = Record<string, any>;

const listOf = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((row) => row !== null && typeof row === 'object') : []);

// ---------------------------------------------------------------- hotspots

/** The number of bands the scores are cut into. */
export const BAND_COUNT = 4;
/** How many fill levels the stylesheet has (`--color-hot-1` to `--color-hot-4`). */
export const HOT_LEVELS = 4;

export interface Band {
  index: number;
  /** The lowest and highest score in the band, as the product lists them. */
  min: number;
  max: number;
  /** How many scores are in the band. */
  count: number;
}

export interface ScoreBands {
  /** The score at which each band after the first starts; a score on a cut is in the higher band. */
  cuts: readonly number[];
  bands: readonly Band[];
  /** How many scores the bands were made from. */
  scored: number;
}

/** The band of `score`: how many cuts it has reached. */
export function bandOf(score: number, bands: Pick<ScoreBands, 'cuts'>): number {
  let band = 0;
  while (band < bands.cuts.length && score >= bands.cuts[band]) band += 1;
  return band;
}

/**
 * Cut `scores` into `parts` bands at their quantiles: the score a quarter, a half and three quarters of the way
 * through the sorted list starts the next band. Equal scores stay in one band, so cuts that coincide (or that fall on
 * the lowest score) merge and there are fewer bands. Nothing here depends on the order the scores arrive in.
 */
export function scoreBands(scores: readonly number[], parts = BAND_COUNT): ScoreBands {
  const sorted = scores.filter((score) => Number.isFinite(score)).sort((a, b) => a - b);
  const n = sorted.length;
  const cuts: number[] = [];
  for (let k = 1; k < parts; k += 1) {
    const cut = sorted[Math.floor((n * k) / parts)];
    if (cut !== undefined && cut > sorted[0] && (cuts.length === 0 || cut > cuts[cuts.length - 1])) cuts.push(cut);
  }
  const bands: Band[] = [];
  if (n > 0) {
    for (let i = 0; i <= cuts.length; i += 1) bands.push({ index: i, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY, count: 0 });
    for (const score of sorted) {
      const band = bands[bandOf(score, { cuts })];
      band.min = Math.min(band.min, score);
      band.max = Math.max(band.max, score);
      band.count += 1;
    }
  }
  return { cuts, bands, scored: n };
}

/** The fill level (1 to HOT_LEVELS) that band `index` of `count` bands is drawn in: the bands are spread over the levels, the highest on the strongest. */
export function hotLevel(index: number, count: number): number {
  return count <= 1 ? HOT_LEVELS - 1 : Math.round((index * (HOT_LEVELS - 1)) / (count - 1)) + 1;
}

export interface HotspotsFacts {
  /** The score of each listed file that has one, by path. */
  scores: ReadonlyMap<string, number>;
  /** Every path the product lists, with or without a score (a binary file has none). */
  listed: ReadonlySet<string>;
  bands: ScoreBands;
}

/** The hotspots product's files: each path once (the first row wins), and the bands of the scores. */
export function hotspotsFacts(product: Json): HotspotsFacts {
  const scores = new Map<string, number>();
  const listed = new Set<string>();
  for (const row of listOf(product.files)) {
    if (typeof row.path !== 'string' || listed.has(row.path)) continue;
    listed.add(row.path);
    if (typeof row.score === 'number' && Number.isFinite(row.score)) scores.set(row.path, row.score);
  }
  return { scores, listed, bands: scoreBands([...scores.values()]) };
}

// ------------------------------------------------------------------ unused

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number] | 'unrated';
export type ConfidenceCounts = Record<Confidence, number>;

const emptyCounts = (): ConfidenceCounts => ({ high: 0, medium: 0, low: 0, unrated: 0 });
const confidenceOf = (value: unknown): Confidence => (value === 'high' || value === 'medium' || value === 'low' ? value : 'unrated');

export interface UnusedFacts {
  /** The confidence of each function the product lists as unused, by node id. */
  byNode: ReadonlyMap<string, Confidence>;
  /** The listed functions of each file node, by confidence. */
  byFile: ReadonlyMap<string, ConfidenceCounts>;
  /** How many listed functions the graph has no node for. */
  notInGraph: number;
  listed: number;
}

/** The unused-code product's `unused` rows, put on the graph's nodes (test-only functions are listed apart and are not marked). */
export function unusedFacts(product: Json, index: Pick<GraphIndex, 'nodesById' | 'owningFile'>): UnusedFacts {
  const mapping = mapUnused(product, index);
  const byNode = new Map<string, Confidence>();
  const byFile = new Map<string, ConfidenceCounts>();
  for (const { record, nodeId } of mapping.mapped) {
    if (byNode.has(nodeId)) continue;
    const confidence = confidenceOf((record as Json).confidence);
    byNode.set(nodeId, confidence);
    const file = index.owningFile.get(nodeId);
    if (file === undefined) continue;
    const counts = byFile.get(file) ?? emptyCounts();
    counts[confidence] += 1;
    byFile.set(file, counts);
  }
  return { byNode, byFile, notInGraph: mapping.notInGraph.length, listed: mapping.mapped.length + mapping.notInGraph.length };
}

// ----------------------------------------------------------------- doc map

export interface DocMapFacts {
  /** The code files of the coverage that some unit's evidence is in, and those that none is in, by path. */
  withEvidence: ReadonlySet<string>;
  withoutEvidence: ReadonlySet<string>;
  /** False while the product has no coverage (it was made before the coverage step ran). */
  hasCoverage: boolean;
}

export function docMapFacts(product: Json): DocMapFacts {
  const coverage = product.coverage;
  const withEvidence = new Set<string>();
  const withoutEvidence = new Set<string>();
  for (const row of listOf(coverage?.files)) {
    if (typeof row.path !== 'string') continue;
    (Array.isArray(row.units) && row.units.length > 0 ? withEvidence : withoutEvidence).add(row.path);
  }
  return { withEvidence, withoutEvidence, hasCoverage: coverage !== null && typeof coverage === 'object' };
}

// ------------------------------------------------------------------- marks

/** What an overlay can draw for a node; an overlay that is off has null. */
export interface OverlayFacts {
  hotspots: HotspotsFacts | null;
  unused: UnusedFacts | null;
  docMap: DocMapFacts | null;
}

export const NO_OVERLAYS: OverlayFacts = { hotspots: null, unused: null, docMap: null };

export const anyOverlay = (facts: OverlayFacts): boolean => facts.hotspots !== null || facts.unused !== null || facts.docMap !== null;

export type ChipTone = Confidence | 'evidence' | 'no-evidence';

export interface Chip {
  text: string;
  tone: ChipTone;
}

/** How a node is drawn under the overlays that are on. */
export interface NodeMarks {
  /** The hotspots fill level, 1 to HOT_LEVELS; null when the overlay is off or the node has no band. */
  hot: number | null;
  chips: readonly Chip[];
  /** What the marks mean for this node, one line for each overlay that is on. */
  title: string | null;
}

const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;
const bandText = (bands: ScoreBands, index: number) => {
  const band = bands.bands[index];
  return `band ${index + 1} of ${bands.bands.length} (${formatNumber(band.min)} to ${formatNumber(band.max)})`;
};

function hotspotsMark(members: readonly FileInfo[], facts: HotspotsFacts, aggregated: boolean): { hot: number | null; line: string } {
  const { bands } = facts;
  let top: number | null = null;
  let topScore = 0;
  let scored = 0;
  let listed = 0;
  for (const file of members) {
    if (facts.listed.has(file.path)) listed += 1;
    const score = facts.scores.get(file.path);
    if (score === undefined) continue;
    scored += 1;
    topScore = Math.max(topScore, score);
    const band = bandOf(score, bands);
    if (top === null || band > top) top = band;
  }
  const hot = top === null ? null : hotLevel(top, bands.bands.length);
  if (!aggregated) {
    const file = members[0];
    if (top !== null) return { hot, line: `Hotspots: score ${formatNumber(facts.scores.get(file.path))}, ${bandText(bands, top)}.` };
    return { hot, line: facts.listed.has(file.path) ? 'Hotspots: the product lists this file without a score.' : 'Hotspots: the product lists no history for this file.' };
  }
  if (top === null) return { hot, line: `Hotspots: none of its ${plural(members.length, 'file')} has a score (${formatNumber(listed)} listed).` };
  return { hot, line: `Hotspots: the highest band among its ${plural(members.length, 'file')}: ${bandText(bands, top)}; the highest score is ${formatNumber(topScore)}; ${formatNumber(scored)} of them ${scored === 1 ? 'has' : 'have'} a score.` };
}

function countsText(counts: ConfidenceCounts): string {
  const parts = ([...CONFIDENCES, 'unrated'] as const).filter((c) => counts[c] > 0).map((c) => `${formatNumber(counts[c])} ${c === 'unrated' ? 'without a confidence' : c}`);
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

const topConfidence = (counts: ConfidenceCounts): Confidence | null => ([...CONFIDENCES, 'unrated'] as const).find((c) => counts[c] > 0) ?? null;

function unusedMark(members: readonly FileInfo[], facts: UnusedFacts, aggregated: boolean): { chip: Chip | null; line: string } {
  const counts = emptyCounts();
  let files = 0;
  for (const file of members) {
    const own = facts.byFile.get(file.id);
    if (!own) continue;
    files += 1;
    for (const c of [...CONFIDENCES, 'unrated'] as const) counts[c] += own[c];
  }
  const total = ([...CONFIDENCES, 'unrated'] as const).reduce((sum, c) => sum + counts[c], 0);
  const top = topConfidence(counts);
  if (total === 0) {
    return { chip: null, line: aggregated ? `Unused: none of the functions of its ${plural(members.length, 'file')} is listed as unused.` : 'Unused: no function of this file is listed as unused.' };
  }
  const chip: Chip = { text: `${formatNumber(total)} unused`, tone: top as Confidence };
  const line = aggregated
    ? `Unused: ${plural(total, 'function')} listed as unused in ${formatNumber(files)} of its ${plural(members.length, 'file')}${countsText(counts)}; coloured by the highest confidence among them.`
    : `Unused: ${plural(total, 'function')} of this file ${total === 1 ? 'is' : 'are'} listed as unused${countsText(counts)}.`;
  return { chip, line };
}

function docMapMark(members: readonly FileInfo[], facts: DocMapFacts, aggregated: boolean): { chip: Chip | null; line: string } {
  let withEvidence = 0;
  let without = 0;
  for (const file of members) {
    if (facts.withEvidence.has(file.path)) withEvidence += 1;
    else if (facts.withoutEvidence.has(file.path)) without += 1;
  }
  const counted = withEvidence + without;
  if (!aggregated) {
    if (withEvidence > 0) return { chip: { text: 'evidence', tone: 'evidence' }, line: 'Doc map: some unit has evidence in this file.' };
    if (without > 0) return { chip: { text: 'no evidence', tone: 'no-evidence' }, line: 'Doc map: no unit has evidence in this file.' };
    return { chip: null, line: facts.hasCoverage ? 'Doc map: this file is not among the code files of the coverage.' : 'Doc map: the product has no coverage yet.' };
  }
  if (counted === 0) return { chip: null, line: `Doc map: none of its ${plural(members.length, 'file')} is among the code files of the coverage.` };
  return {
    chip: { text: `${formatNumber(withEvidence)}/${formatNumber(counted)} evidence`, tone: withEvidence > 0 ? 'evidence' : 'no-evidence' },
    line: `Doc map: ${formatNumber(withEvidence)} of its ${plural(counted, 'counted file')} ${withEvidence === 1 ? 'has' : 'have'} evidence; ${plural(members.length - counted, 'file')} ${members.length - counted === 1 ? 'is' : 'are'} not among the coverage.`,
  };
}

/**
 * How an entry of a level is drawn: `members` are the files it stands for (one for a file node). A directory, a layer
 * or a fold (`aggregated`) takes what its files have, and its title says so. Null when no overlay is on.
 */
export function entryMarks(members: readonly FileInfo[], facts: OverlayFacts, aggregated: boolean): NodeMarks | null {
  if (!anyOverlay(facts) || members.length === 0) return null;
  const lines: string[] = [];
  const chips: Chip[] = [];
  let hot: number | null = null;
  if (facts.hotspots) {
    const mark = hotspotsMark(members, facts.hotspots, aggregated);
    hot = mark.hot;
    lines.push(mark.line);
  }
  if (facts.unused) {
    const mark = unusedMark(members, facts.unused, aggregated);
    if (mark.chip) chips.push(mark.chip);
    lines.push(mark.line);
  }
  if (facts.docMap) {
    const mark = docMapMark(members, facts.docMap, aggregated);
    if (mark.chip) chips.push(mark.chip);
    lines.push(mark.line);
  }
  return { hot, chips, title: lines.join('\n') };
}

/** How a function row inside an open file is drawn: marked when the unused-code product lists it. */
export function nodeMarks(nodeId: string, facts: OverlayFacts): { confidence: Confidence | null; title: string | null } | null {
  if (!facts.unused) return null;
  const confidence = facts.unused.byNode.get(nodeId) ?? null;
  return {
    confidence,
    title: confidence === null ? null : `Unused: listed as unused${confidence === 'unrated' ? ', without a confidence' : `, confidence ${confidence}`}.`,
  };
}

// ------------------------------------------------------------------ legend

export interface LegendRow {
  label: string;
  /** A fill level of the hotspots scale, or a chip tone. */
  swatch: { hot: number } | { tone: ChipTone };
  /** How many files or functions the row covers, when the product gives it. */
  count: number | null;
}

export interface Legend {
  overlay: OverlayName;
  title: string;
  rows: readonly LegendRow[];
  /** How the marks are made and what they cover. */
  note: string;
}

const AGGREGATE_NOTE = 'A directory, layer or fold takes what its files have.';

/** The legend of one overlay that is on: the colours and what they stand for, and how the bands or marks were made. */
export function legendOf(overlay: OverlayName, facts: OverlayFacts): Legend | null {
  const title = OVERLAYS[overlay].label;
  if (overlay === 'hotspots' && facts.hotspots) {
    const { bands } = facts.hotspots;
    if (bands.scored === 0) return { overlay, title, rows: [], note: 'The product lists no file with a score, so there are no bands.' };
    const cutText = bands.cuts.length === 0 ? 'no cut point, since every score is the same' : `cut points ${bands.cuts.map((cut) => formatNumber(cut)).join(', ')}`;
    return {
      overlay,
      title,
      rows: bands.bands.map((band) => ({
        label: band.min === band.max ? formatNumber(band.min) : `${formatNumber(band.min)} ${EN_DASH} ${formatNumber(band.max)}`,
        swatch: { hot: hotLevel(band.index, bands.bands.length) },
        count: band.count,
      })),
      note: `Bands are the quartiles of the ${formatNumber(bands.scored)} file scores the product lists (${cutText}). A score on a cut point is in the higher band. A directory, layer or fold takes the highest band among its files.`,
    };
  }
  if (overlay === 'unused' && facts.unused) {
    const counts = emptyCounts();
    for (const confidence of facts.unused.byNode.values()) counts[confidence] += 1;
    const rows: LegendRow[] = ([...CONFIDENCES, 'unrated'] as const).filter((c) => counts[c] > 0 || c !== 'unrated').map((c) => ({ label: c === 'unrated' ? 'without a confidence' : `${c} confidence`, swatch: { tone: c }, count: counts[c] }));
    const missing = facts.unused.notInGraph > 0 ? ` ${plural(facts.unused.notInGraph, 'listed function')} ${facts.unused.notInGraph === 1 ? 'has' : 'have'} no node in the graph.` : '';
    return {
      overlay,
      title,
      rows,
      note: `Marks the functions the unused-code product lists as unused, and the files that hold them, with the product's confidence. A directory, layer or fold shows how many listed functions its files hold, in the colour of the highest confidence among them. Functions listed as used only by tests are not marked.${missing}`,
    };
  }
  if (overlay === 'doc-map' && facts.docMap) {
    const { docMap } = facts;
    if (!docMap.hasCoverage) return { overlay, title, rows: [], note: "The doc map has no coverage yet, so no file is marked." };
    return {
      overlay,
      title,
      rows: [
        { label: 'with evidence', swatch: { tone: 'evidence' }, count: docMap.withEvidence.size },
        { label: 'without evidence', swatch: { tone: 'no-evidence' }, count: docMap.withoutEvidence.size },
      ],
      note: `Marks the code files of the doc map's coverage. A file without evidence means only that no unit's evidence is in it; a file outside the coverage is not marked. ${AGGREGATE_NOTE} It shows how many of its counted files have evidence.`,
    };
  }
  return null;
}

// ------------------------------------------------------------ availability

/** Whether an overlay can be turned on, and what the toggle says when it cannot. */
export function overlayAvailability(product: { status: string; reason?: string | null } | null | undefined): { enabled: boolean; text: string | null } {
  if (!product || product.status === 'not-run') return { enabled: false, text: 'not run' };
  if (product.status === 'unreadable') return { enabled: false, text: 'unreadable' };
  return { enabled: true, text: null };
}

export interface LegendBlock {
  overlay: OverlayName;
  title: string;
  rows: Legend['rows'];
  note: string;
}

export type OverlayProducts = Partial<Record<OverlayName, { status: string; revision?: string | null } | undefined>>;

/**
 * What the legend says for each overlay that is on, in the fixed order: its colours and how they were made, or, when
 * its product is not in the page, is still being read or could not be read, that.
 */
export function legendBlocks(on: readonly OverlayName[], facts: OverlayFacts, products: OverlayProducts, state: { pending: boolean; error: string | null }): LegendBlock[] {
  const blocks: LegendBlock[] = [];
  for (const overlay of OVERLAYS_IN_ORDER) {
    if (!on.includes(overlay)) continue;
    const title = OVERLAYS[overlay].label;
    const product = products[overlay];
    const availability = overlayAvailability(product);
    if (!availability.enabled) {
      blocks.push({ overlay, title, rows: [], note: `The ${title.toLowerCase()} product is ${availability.text}: nothing is marked.` });
      continue;
    }
    const legend = legendOf(overlay, facts);
    const revision = product?.status === 'different-revision' ? ` The product was made at ${product.revision}, not at the source snapshot.` : '';
    if (legend) blocks.push({ overlay, title, rows: legend.rows, note: legend.note + revision });
    else if (state.error !== null) blocks.push({ overlay, title, rows: [], note: `The product could not be read: ${state.error}` });
    else blocks.push({ overlay, title, rows: [], note: 'Reading the product.' });
  }
  return blocks;
}
