// Embedded source text (artifact-view task 7.1): an evidence row's line text
// and a node's excerpt, or why it is not in this page. The reason comes only
// from what the bake recorded (`meta.embeds`, `meta.dropped`,
// `meta.source.embedding`); the page never guesses one. Pure and DOM-free.
import { isTable, type Meta, type Segments } from '../data';

export type SourceSegment = 'evidenceText' | 'excerpts';

export type NotEmbeddedReason =
  /** Baked with --no-source. */
  | 'no-source'
  /** The segment was dropped whole to fit --source-budget. */
  | 'budget'
  /** The segment is in the page, but this file's content no longer matched the manifest. */
  | 'hash-mismatch'
  /** The segment is in the page, but this row has no text; the bake's counts are all that is known. */
  | 'not-embedded-for-file'
  /** The bundle records nothing about this segment. */
  | 'not-recorded';

export type SourceText =
  | { state: 'embedded'; text: string }
  | { state: 'not-embedded'; reason: NotEmbeddedReason; message: string };

function segmentState(meta: Meta, segments: Segments, segment: SourceSegment): { embedded: true } | { embedded: false; reason: NotEmbeddedReason } {
  const entry = (meta.embeds ?? []).find((e) => e.segment === segment);
  const dropped = (meta.dropped ?? []).find((d) => d.segment === segment);
  if (dropped?.reason === 'no-source' || entry?.reason === 'no-source') return { embedded: false, reason: 'no-source' };
  if (dropped?.reason === 'budget' || entry?.reason === 'budget') return { embedded: false, reason: 'budget' };
  if (entry?.status === 'embedded' && isTable(segments[segment]) && Array.isArray(segments[`${segment}.strings`])) return { embedded: true };
  return { embedded: false, reason: 'not-recorded' };
}

function budgetText(meta: Meta): string {
  const bytes = meta.source?.budgetBytes;
  return typeof bytes === 'number' ? ` (${Math.round(bytes / (1024 * 1024))} MB)` : '';
}

const WHAT: Record<SourceSegment, string> = { evidenceText: 'evidence line text', excerpts: 'symbol excerpts' };

/** The page-level message for a reason. */
export function reasonMessage(meta: Meta, segment: SourceSegment, reason: NotEmbeddedReason, file?: string | null): string {
  const what = WHAT[segment];
  if (reason === 'no-source') return 'Source not embedded: this page was baked with --no-source.';
  if (reason === 'budget') return `Source not embedded: the ${what} were dropped to fit the source budget${budgetText(meta)}.`;
  if (reason === 'hash-mismatch') return `Source not embedded: ${file ?? 'this file'} no longer matched its manifest content hash when the page was baked.`;
  if (reason === 'not-embedded-for-file') {
    const e = meta.source?.embedding ?? {};
    const parts = [
      `${e.filesHashMismatch ?? 0} with a content hash mismatch`,
      `${e.filesNotInManifest ?? 0} not in the manifest`,
      `${e.filesUnreadable ?? 0} unreadable`,
      `${e.linesOutOfRange ?? 0} lines out of range`,
    ];
    return `Source not embedded for this location. The bake recorded cited files it could not embed: ${parts.join(', ')} (see the inventory on the overview).`;
  }
  return `Source not embedded: this page records nothing about its ${what}.`;
}

function lookup(meta: Meta, segments: Segments, segment: SourceSegment, row: number, file: string | null): SourceText {
  const state = segmentState(meta, segments, segment);
  if (!state.embedded) return { state: 'not-embedded', reason: state.reason, message: reasonMessage(meta, segment, state.reason) };
  const table = segments[segment] as { columns: Record<string, Int32Array> };
  const texts = segments[`${segment}.strings`] as string[];
  const cell = table.columns.text?.[row] ?? -1;
  if (cell >= 0 && typeof texts[cell] === 'string') return { state: 'embedded', text: texts[cell] };
  const mismatch = file !== null && (meta.source?.embedding?.hashMismatchSamples ?? []).includes(file);
  const reason: NotEmbeddedReason = mismatch ? 'hash-mismatch' : 'not-embedded-for-file';
  return { state: 'not-embedded', reason, message: reasonMessage(meta, segment, reason, file) };
}

/** The text of the evidence row's line. */
export function evidenceLineText(meta: Meta, segments: Segments, evidenceRow: number, file: string | null): SourceText {
  return lookup(meta, segments, 'evidenceText', evidenceRow, file);
}

/** The node's excerpt (its lineRange, lines joined by "\n"). */
export function nodeExcerpt(meta: Meta, segments: Segments, nodeRow: number, file: string | null): SourceText {
  return lookup(meta, segments, 'excerpts', nodeRow, file);
}
