/**
 * What the graph and the panels read from the relations product (`relations-graph.json`, written by
 * /excavator-relations): the relations as rows and the runtime units. Pure functions over the product as written:
 * a field the product does not hold reads as null.
 */

import { isTable, listOf, type Table } from '../views/shared/shape';

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const integer = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);

export interface EvidenceLine {
  file: string | null;
  line: number | null;
  quote: string | null;
}

/** One end of a relation: the line that sends, or the line that registers the handler. */
export interface RelationSite {
  unit: string | null;
  file: string | null;
  line: number | null;
  quote: string | null;
  nodeId: string | null;
  evidence: EvidenceLine[];
}

export interface Candidate {
  unit: string | null;
  file: string | null;
  line: number | null;
  addressKey: string | null;
}

export interface RelationRow {
  id: string;
  /** The kind; null for a malformed analyzer relation the merge kept as quote-failed without a string kind. */
  kind: string | null;
  bucket: string;
  /** The address in words: the normalized key, or why there is none. */
  address: string | null;
  reason: string | null;
  confidence: string | null;
  area: string | null;
  caller: RelationSite | null;
  /** The receiving site; null for an external system (see `external`) and for an end with no receiver. */
  receiver: RelationSite | null;
  external: string | null;
  candidates: Candidate[];
  targetUnitMissed: boolean;
  /** The role of an end the merge kept alone (`caller` or `receiver`), as the product records it. */
  role: string | null;
}

export interface UnitInfo {
  id: string;
  name: string;
  root: string | null;
  kind: string | null;
}

const evidenceOf = (value: unknown): EvidenceLine[] => listOf(value).map((e) => ({ file: text(e.file), line: integer(e.line), quote: text(e.quote) }));

function siteOf(value: unknown): RelationSite | null {
  if (!isTable(value) || text(value.file) === null) return null;
  return { unit: text(value.unit), file: text(value.file), line: integer(value.line), quote: text(value.quote), nodeId: text(value.nodeId), evidence: evidenceOf(value.evidence) };
}

function addressOf(raw: Table): string | null {
  const key = text(raw.addressKey);
  if (key !== null) return key;
  if (text(raw.unresolved) !== null) return `unresolved: ${raw.unresolved}`;
  if (isTable(raw.rejection) && text(raw.rejection.reason) !== null) {
    return `rejected: ${raw.rejection.reason}${text(raw.rejection.detail) === null ? '' : ` (${raw.rejection.detail})`}`;
  }
  return null;
}

/** Every relation of the product, in the product's order; an item without an id or a bucket is not a relation. */
export function relationRows(product: unknown): RelationRow[] {
  if (!isTable(product)) return [];
  return listOf(product.relations)
    .filter((raw) => text(raw.id) !== null && text(raw.bucket) !== null)
    .map((raw) => {
      const receiverRaw = raw.receiver;
      const external = isTable(receiverRaw) ? text(receiverRaw.external) : null;
      return {
        id: raw.id,
        kind: text(raw.kind),
        bucket: raw.bucket,
        address: addressOf(raw),
        reason: text(raw.reason),
        confidence: text(raw.confidence),
        area: text(raw.area),
        caller: siteOf(raw.caller),
        receiver: external === null ? siteOf(receiverRaw) : null,
        external,
        candidates: listOf(raw.candidates).map((c) => ({ unit: text(c.unit), file: text(c.file), line: integer(c.line), addressKey: text(c.addressKey) })),
        targetUnitMissed: raw.targetUnitMissed === true,
        role: text(raw.role),
      };
    });
}

/** `file:line`, the file alone when there is no line, null without a file. */
export function siteText(site: Pick<RelationSite, 'file' | 'line'> | null): string | null {
  if (site === null || site.file === null) return null;
  return site.line === null ? site.file : `${site.file}:${site.line}`;
}

/** The words an external system is shown by: its id without the `external:` prefix. */
export const externalLabel = (id: string): string => id.replace(/^external:/, '');

export function unitsOf(product: unknown): UnitInfo[] {
  if (!isTable(product)) return [];
  return listOf(product.units)
    .filter((u) => text(u.id) !== null && typeof u.name === 'string')
    .map((u) => ({ id: u.id, name: u.name, root: text(u.root), kind: text(u.kind) }));
}

/**
 * What the details of a relation say for an end it has no site for, or null when it has one (or when the other end's
 * sentence already says it). Only a receiver-only end is one no caller reaches; an unpaired receiving end in another
 * bucket was never paired; a relation with neither site (one the analyzer wrote with no end, or whose only end could
 * not be read) gets one sentence for both roles.
 */
export function missingEndText(row: RelationRow, side: 'caller' | 'receiver'): string | null {
  const hasReceiver = row.receiver !== null || row.external !== null;
  if (side === 'caller') {
    if (row.caller !== null) return null;
    if (!hasReceiver) return `The analyzer wrote no readable site for this relation (${row.bucket}).`;
    if (row.bucket === 'receiver-only') return 'No caller site: no caller on another unit reaches this address.';
    if (row.role === 'receiver') return `No caller site: this receiving site is ${row.bucket}, and the merge pairs only ends that pass the quote check and resolve an address.`;
    return `No caller site recorded (${row.bucket}).`;
  }
  if (hasReceiver || row.caller === null) return null;
  if (row.bucket === 'ambiguous') return 'No single receiving site: several receivers match this address (ambiguous).';
  return `No receiving site (${row.bucket}).`;
}
