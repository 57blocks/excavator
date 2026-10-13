// Rebuilds the source index's term -> chunk postings from the decoded chunk
// table (artifact-view task 4A.2): the bake no longer embeds postings, since
// they are derivable. A chunk's terms are its identifier tokens plus, when
// the literal text is embedded, the subword split of its comments and string
// literals: the same bag the index builder posts. Without embedded literals
// the result covers identifiers only and says so in `scope`.
//
// Pure and DOM-free so it runs in the decode Worker and in Node tests.
import { isTable, type Segments, type Table } from '../data';

export interface TermIndex {
  /** Distinct terms in ascending code-unit order. */
  terms: string[];
  /** `chunks[offsets[i] .. offsets[i + 1])` are the chunk rows of `terms[i]`. */
  offsets: Int32Array;
  /** Chunk rows (ordinals in `index.chunks`), ascending within a term. */
  chunks: Int32Array;
  scope: 'identifiers+literals' | 'identifiers';
}

/**
 * Subword split on camelCase, PascalCase, snake_case, kebab-case and acronym
 * runs, lowercased. Mirrors `splitIdentifier` in
 * skills/excavator/build-source-index.mjs (a test pins the two together).
 */
export function splitIdentifier(raw: string): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** How often `rebuildPostings` reports progress, in chunk rows. */
export const PROGRESS_EVERY_ROWS = 8192;

/**
 * The rebuilt index, or null when the bundle carries no source index.
 * `onProgress(done, total)` is called every PROGRESS_EVERY_ROWS chunk rows and
 * once at the end (the rebuild takes seconds on a large graph).
 */
export function rebuildPostings(
  segments: Segments,
  strings: string[],
  onProgress?: (done: number, total: number) => void,
): TermIndex | null {
  const chunks = segments['index.chunks'];
  const tokens = segments['index.tokens'];
  if (!isTable(chunks) || !isTable(tokens)) return null;
  const literalTable = segments.indexLiterals;
  const literalStrings = segments['indexLiterals.strings'];
  const literals = isTable(literalTable) && Array.isArray(literalStrings)
    ? { cells: literalTable.columns.text, texts: literalStrings as string[] }
    : null;

  const { idOffset, idCount, commentOffset, commentCount, stringOffset, stringCount } = (chunks as Table).columns;
  const tokenCells = (tokens as Table).columns.token;
  const byTerm = new Map<string, number[]>();
  const post = (term: string, row: number) => {
    let list = byTerm.get(term);
    if (!list) {
      list = [];
      byTerm.set(term, list);
    }
    // Rows are visited in ascending order, so a repeat is always the last entry.
    if (list[list.length - 1] !== row) list.push(row);
  };
  const postLiterals = (offset: number, count: number, row: number) => {
    if (!literals || offset < 0 || count <= 0) return;
    for (let i = offset; i < offset + count; i += 1) {
      const cell = literals.cells[i];
      if (cell >= 0) for (const term of splitIdentifier(literals.texts[cell])) post(term, row);
    }
  };

  for (let row = 0; row < (chunks as Table).rows; row += 1) {
    const start = idOffset[row];
    const count = idCount[row];
    if (start >= 0 && count > 0) {
      for (let i = start; i < start + count; i += 1) {
        const cell = tokenCells[i];
        if (cell >= 0 && typeof strings[cell] === 'string') post(strings[cell], row);
      }
    }
    if (commentOffset && commentCount) postLiterals(commentOffset[row], commentCount[row], row);
    if (stringOffset && stringCount) postLiterals(stringOffset[row], stringCount[row], row);
    if (onProgress && (row + 1) % PROGRESS_EVERY_ROWS === 0) onProgress(row + 1, (chunks as Table).rows);
  }
  onProgress?.((chunks as Table).rows, (chunks as Table).rows);

  const terms = [...byTerm.keys()].sort(compare);
  const offsets = new Int32Array(terms.length + 1);
  let total = 0;
  terms.forEach((term, i) => {
    offsets[i] = total;
    total += (byTerm.get(term) as number[]).length;
  });
  offsets[terms.length] = total;
  const flat = new Int32Array(total);
  terms.forEach((term, i) => flat.set(byTerm.get(term) as number[], offsets[i]));
  return { terms, offsets, chunks: flat, scope: literals ? 'identifiers+literals' : 'identifiers' };
}

/** Chunk rows for one exact term (empty when absent). */
export function lookupTerm(index: TermIndex, term: string): Int32Array {
  let lo = 0;
  let hi = index.terms.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = compare(index.terms[mid], term);
    if (c === 0) return index.chunks.subarray(index.offsets[mid], index.offsets[mid + 1]);
    if (c < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return new Int32Array(0);
}
