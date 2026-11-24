/**
 * What the Relations view reads from the relations product (`relations-graph.json` and its coverage report, written by
 * /excavator-relations): the relations as rows, the units with what each one calls and receives, the links between
 * units and to external systems, the bucket counts and the measurements. Pure functions over the product as written:
 * a field the product does not hold reads as null, a bucket the page does not know is listed after the known ones,
 * and nothing is computed that the product does not state but a count or a grouping of its own records.
 */

import { isTable, listOf, type Table } from '../views/shared/shape';

/** The caller's buckets and the receiver's, in the merge's order. */
export const CALLER_BUCKETS = ['linked', 'ambiguous', 'caller-only', 'address-unresolved', 'quote-failed'] as const;
export const RECEIVER_BUCKETS = ['linked', 'receiver-only', 'address-unresolved', 'quote-failed'] as const;

/** What each bucket says about an end, in the merge's terms. */
export const BUCKET_WORDS: Readonly<Record<string, string>> = {
  linked: 'paired by address with a site on another unit, or with an external system',
  ambiguous: 'its address matches receivers on more than one other side',
  'caller-only': 'no receiver on another unit has its address',
  'receiver-only': 'no caller on another unit reaches its address',
  'address-unresolved': 'its address could not be resolved from the cited lines',
  'quote-failed': 'the check rejected this end, so it was never paired',
};

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const integer = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);
const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const strings = (value: unknown): string[] | null => (Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null);
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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
  kind: string;
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

/** Every relation of the product, in the product's order; an item without an id, kind or bucket is not a relation. */
export function relationRows(product: unknown): RelationRow[] {
  if (!isTable(product)) return [];
  return listOf(product.relations)
    .filter((raw) => text(raw.id) !== null && text(raw.kind) !== null && text(raw.bucket) !== null)
    .map((raw) => {
      const receiverRaw = raw.receiver;
      const external = isTable(receiverRaw) ? text(receiverRaw.external) : null;
      return {
        id: raw.id,
        kind: raw.kind,
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

export interface Reach {
  kind: string;
  /** A unit id, or an external system's id. */
  target: string;
  external: boolean;
  relations: number;
}

export interface UnitSummary {
  unit: UnitInfo;
  /** The unit's caller ends by bucket; buckets with none are left out. */
  calls: Record<string, number>;
  /** The unit's receiver ends by bucket; buckets with none are left out. */
  receives: Record<string, number>;
  /** The units and external systems its linked relations reach. */
  reaches: Reach[];
}

const bump = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** What each unit calls and receives. A relation counts once for its caller's unit and once for its receiver's. */
export function unitSummaries(units: readonly UnitInfo[], rows: readonly RelationRow[]): UnitSummary[] {
  return units.map((unit) => {
    const calls: Record<string, number> = {};
    const receives: Record<string, number> = {};
    const reach = new Map<string, Reach>();
    for (const row of rows) {
      if (row.caller?.unit === unit.id) {
        bump(calls, row.bucket);
        const target = row.external ?? row.receiver?.unit ?? null;
        if (row.bucket === 'linked' && target !== null) {
          const key = `${row.kind}|${target}`;
          const found = reach.get(key) ?? { kind: row.kind, target, external: row.external !== null, relations: 0 };
          found.relations += 1;
          reach.set(key, found);
        }
      }
      if (row.receiver?.unit === unit.id) bump(receives, row.bucket);
    }
    const reaches = [...reach.values()].sort((a, b) => byText(a.kind, b.kind) || byText(a.target, b.target));
    return { unit, calls, receives, reaches };
  });
}

/**
 * The relations whose sites name no unit, by bucket. A quote-failed end keeps the site as the analyzer wrote it,
 * without its unit, so the unit list cannot count it; the page says how many there are instead of leaving them out.
 */
export function endsWithoutUnit(rows: readonly RelationRow[]): { total: number; byBucket: Record<string, number> } {
  const byBucket: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    if (typeof row.caller?.unit === 'string' || typeof row.receiver?.unit === 'string') continue;
    total += 1;
    bump(byBucket, row.bucket);
  }
  return { total, byBucket };
}

/**
 * What the details of a relation say for an end it has no site for, or null when it has one (or when the other end's
 * sentence already says it). Only a receiver-only end is one no caller reaches; an unpaired receiving end in another
 * bucket was never paired, and an end whose own site could not be read says so.
 */
export function missingEndText(row: RelationRow, side: 'caller' | 'receiver'): string | null {
  const hasReceiver = row.receiver !== null || row.external !== null;
  if (side === 'caller') {
    if (row.caller !== null) return null;
    if (row.bucket === 'receiver-only') return 'No caller site: no caller on another unit reaches this address.';
    if (row.role === 'receiver' && hasReceiver) return `No caller site: this receiving site is ${row.bucket}, and the merge pairs only ends that pass the quote check and resolve an address.`;
    if (row.role === 'caller') return `The caller site the analyzer wrote could not be read (${row.bucket}).`;
    return `No caller site recorded (${row.bucket}).`;
  }
  if (hasReceiver) return null;
  if (row.role === 'receiver') return `The receiving site the analyzer wrote could not be read (${row.bucket}).`;
  if (row.caller === null) return null;
  if (row.bucket === 'ambiguous') return 'No single receiving site: several receivers match this address (ambiguous).';
  return `No receiving site (${row.bucket}).`;
}

export interface LinkRow {
  key: string;
  kind: string;
  from: string;
  to: string;
  external: boolean;
  relations: RelationRow[];
  /** Distinct caller lines, and receiver lines (0 for an external system). */
  callerSites: number;
  receiverSites: number;
}

/** The linked relations grouped by kind, caller unit and receiver unit or external system, sorted by those three. */
export function unitLinks(rows: readonly RelationRow[]): LinkRow[] {
  const links = new Map<string, LinkRow>();
  for (const row of rows) {
    const from = row.caller?.unit ?? null;
    const to = row.external ?? row.receiver?.unit ?? null;
    if (row.bucket !== 'linked' || from === null || to === null) continue;
    const key = `${row.kind}|${from}|${to}`;
    const link = links.get(key) ?? { key, kind: row.kind, from, to, external: row.external !== null, relations: [], callerSites: 0, receiverSites: 0 };
    link.relations.push(row);
    links.set(key, link);
  }
  for (const link of links.values()) {
    link.callerSites = new Set(link.relations.map((r) => siteText(r.caller))).size;
    link.receiverSites = new Set(link.relations.map((r) => siteText(r.receiver)).filter((s) => s !== null)).size;
  }
  return [...links.values()].sort((a, b) => byText(a.kind, b.kind) || byText(a.from, b.from) || byText(a.to, b.to));
}

export interface ExternalRow {
  id: string;
  /** The caller units, sorted. */
  units: string[];
  relations: RelationRow[];
  /** The names and hosts the analyzers wrote for it, when the product lists them. */
  names: string[] | null;
  hosts: string[] | null;
  /** How the merge keyed it (`name`, `host`), when the product records it. */
  keyBy: string[] | null;
}

/** Every external system: the product's list first, in its order, then any a relation names that the list lacks. */
export function externalSystems(product: unknown, rows: readonly RelationRow[]): ExternalRow[] {
  const listed = isTable(product) ? listOf(product.externals).filter((e) => text(e.id) !== null) : [];
  const ids = listed.map((e) => e.id as string);
  const extra = [...new Set(rows.map((r) => r.external).filter((id): id is string => id !== null && !ids.includes(id)))].sort(byText);
  const info = new Map(listed.map((e) => [e.id as string, e]));
  return [...ids, ...extra].map((id) => {
    const relations = rows.filter((r) => r.external === id);
    const units = [...new Set(relations.map((r) => r.caller?.unit).filter((u): u is string => typeof u === 'string'))].sort(byText);
    const entry = info.get(id);
    return { id, units, relations, names: strings(entry?.names), hosts: strings(entry?.hosts), keyBy: strings(entry?.keyBy) };
  });
}

export interface BucketRow {
  bucket: string;
  count: number | null;
}

/** Each role's bucket counts: the merge's buckets in its order, then any other bucket the product holds, in its order. */
export function bucketRows(buckets: unknown): { caller: BucketRow[]; receiver: BucketRow[] } {
  const rowsOf = (counts: unknown, known: readonly string[]): BucketRow[] => {
    if (!isTable(counts)) return [];
    const names = [...known.filter((b) => Object.prototype.hasOwnProperty.call(counts, b)), ...Object.keys(counts).filter((b) => !known.includes(b))];
    return names.map((bucket) => ({ bucket, count: number(counts[bucket]) }));
  };
  return isTable(buckets) ? { caller: rowsOf(buckets.caller, CALLER_BUCKETS), receiver: rowsOf(buckets.receiver, RECEIVER_BUCKETS) } : { caller: [], receiver: [] };
}

export interface MeasurementRow {
  kind: string;
  ends: number | null;
  quoteFailed: number | null;
  quoteFailureRate: number | null;
  unresolved: number | null;
  unresolvedShare: number | null;
  linked: number | null;
  /** The agreement's status, with the Jaccard when there is one. */
  agreement: string | null;
  escalation: string[];
}

/** One row per kind, in the product's order. */
export function measurementRows(measurements: unknown): MeasurementRow[] {
  if (!isTable(measurements)) return [];
  return Object.entries(measurements)
    .filter(([, m]) => isTable(m))
    .map(([kind, m]) => {
      const agreement = isTable(m.agreement) ? m.agreement : null;
      const status = agreement ? text(agreement.status) : null;
      const jaccard = agreement ? number(agreement.jaccard) : null;
      return {
        kind,
        ends: number(m.ends),
        quoteFailed: number(m.quoteFailed),
        quoteFailureRate: number(m.quoteFailureRate),
        unresolved: number(m.unresolved),
        unresolvedShare: number(m.unresolvedShare),
        linked: number(m.linked),
        agreement: status === null ? null : jaccard === null ? status : `${status} ${jaccard}`,
        escalation: isTable(m.escalation) ? strings(m.escalation.reasons) ?? [] : [],
      };
    });
}

const shown = (value: number | null) => (value === null ? 'not recorded' : String(value));

/**
 * Each escalation candidate as the measurement and the threshold it crossed, one line per reason, in the order the
 * candidates list them. A reason the page does not know is written as it stands.
 */
export function escalationLines(candidates: unknown, measurements: unknown, thresholds: unknown): string[] {
  const t = isTable(thresholds) ? thresholds : {};
  const lines: string[] = [];
  for (const candidate of listOf(candidates)) {
    const kind = text(candidate.kind);
    if (kind === null) continue;
    const m = isTable(measurements) && isTable(measurements[kind]) ? measurements[kind] : {};
    const jaccard = isTable(m.agreement) ? number(m.agreement.jaccard) : null;
    for (const reason of strings(candidate.reasons) ?? []) {
      if (reason === 'agreement') lines.push(`${kind}: agreement with the previous run ${shown(jaccard)}, below the threshold ${shown(number(t.agreement))}`);
      else if (reason === 'quote-failure') lines.push(`${kind}: quote failure rate ${shown(number(m.quoteFailureRate))}, above the threshold ${shown(number(t.quoteFailureRate))}`);
      else if (reason === 'unresolved') lines.push(`${kind}: unresolved address share ${shown(number(m.unresolvedShare))}, above the threshold ${shown(number(t.unresolvedShare))}`);
      else lines.push(`${kind}: ${reason}`);
    }
  }
  return lines;
}

/** The escalation candidates the measurements mark, in the shape the coverage report lists them. */
export function candidatesOf(measurements: unknown): { kind: string; reasons: string[] }[] {
  return measurementRows(measurements).filter((r) => r.escalation.length > 0).map((r) => ({ kind: r.kind, reasons: r.escalation }));
}
