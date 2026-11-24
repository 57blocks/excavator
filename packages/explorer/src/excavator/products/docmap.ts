/**
 * Joining `doc-map/checks.json` to the doc map's units, for the node panel. Quotes, reasons and searches are shown as the products wrote them.
 */

export const NOT_CHECKED = 'not checked';

export interface DocMapCheck {
  unit: number;
  file: string;
  line: number;
  verdict: string;
  reason?: string | null;
}

export interface EvidenceRow {
  file: string | null;
  line: number | null;
  code: string | null;
  check: { verdict: string; reason: string | null } | null;
}

export interface VerdictCounts {
  does: number;
  not: number;
  none: number;
  unchecked: number;
  other: number;
}

export interface SearchRecord {
  pattern?: unknown;
  paths?: unknown;
}

export interface UnitRow {
  number: number;
  document: string | null;
  id: string | null;
  title: string | null;
  quote: string | null;
  line: number | null;
  page: number | null;
  codeStatus: string;
  evidence: EvidenceRow[];
  searched: SearchRecord[];
  verdicts: VerdictCounts;
  verdictText: string | null;
}

export interface JoinedUnits {
  rows: UnitRow[];
  hasChecks: boolean;
  /** Checks that name no evidence of any unit. */
  unmatched: number;
  /** Checks whose unit, file and line an earlier check already has (the first is used). */
  duplicates: number;
}

const checkKey = (unit: number, file: unknown, line: unknown) => `${unit} ${String(file)}:${String(line)}`;
const numberOrNull = (value: unknown) => (typeof value === 'number' ? value : null);
const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

function countVerdicts(evidence: readonly EvidenceRow[]): VerdictCounts {
  const counts: VerdictCounts = { does: 0, not: 0, none: 0, unchecked: 0, other: 0 };
  for (const item of evidence) {
    if (item.check === null) counts.unchecked += 1;
    else if (item.check.verdict === 'does' || item.check.verdict === 'not' || item.check.verdict === 'none') counts[item.check.verdict] += 1;
    else counts.other += 1;
  }
  return counts;
}

/** "does 3 / not 0 / none 0", with unchecked and other pieces added when there are some; no text for a unit without evidence. */
function verdictText(counts: VerdictCounts, evidenceCount: number): string | null {
  if (evidenceCount === 0) return null;
  if (counts.unchecked === evidenceCount) return NOT_CHECKED;
  let text = `does ${counts.does} / not ${counts.not} / none ${counts.none}`;
  if (counts.unchecked > 0) text += ` / not checked ${counts.unchecked}`;
  if (counts.other > 0) text += ` / other ${counts.other}`;
  return text;
}

/**
 * Join the checks to the units. A check belongs to the evidence of the unit (1-based number) that has the same
 * file and line. `checks` is null when the page holds no `doc-map/checks.json`.
 */
export function joinChecks(units: readonly Record<string, any>[], checks: readonly DocMapCheck[] | null): JoinedUnits {
  const hasChecks = Array.isArray(checks);
  const byKey = new Map<string, { check: DocMapCheck; used: boolean }>();
  let duplicates = 0;
  for (const check of hasChecks ? (checks as readonly DocMapCheck[]) : []) {
    const key = checkKey(check.unit, check.file, check.line);
    if (byKey.has(key)) duplicates += 1;
    else byKey.set(key, { check, used: false });
  }
  const rows = units.map((unit, index): UnitRow => {
    const number = index + 1;
    const code = unit.code && typeof unit.code === 'object' ? unit.code : null;
    const evidence = (code && Array.isArray(code.evidence) ? code.evidence : []).map((item: Record<string, unknown>): EvidenceRow => {
      const entry = byKey.get(checkKey(number, item.file, item.line));
      if (entry) entry.used = true;
      return {
        file: textOrNull(item.file),
        line: numberOrNull(item.line),
        code: textOrNull(item.code),
        check: entry ? { verdict: entry.check.verdict, reason: textOrNull(entry.check.reason) } : null,
      };
    });
    const verdicts = countVerdicts(evidence);
    return {
      number,
      document: textOrNull(unit.document),
      id: textOrNull(unit.id),
      title: textOrNull(unit.title),
      quote: textOrNull(unit.quote),
      line: numberOrNull(unit.line),
      page: numberOrNull(unit.page),
      codeStatus: code && typeof code.status === 'string' ? code.status : 'not-checked',
      evidence,
      searched: code && Array.isArray(code.searched) ? code.searched : [],
      verdicts,
      verdictText: verdictText(verdicts, evidence.length),
    };
  });
  let unmatched = 0;
  for (const entry of byKey.values()) if (!entry.used) unmatched += 1;
  return { rows, hasChecks, unmatched, duplicates };
}
