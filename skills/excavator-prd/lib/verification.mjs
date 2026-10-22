/**
 * The reply lines of excavator-verify (its Phase 6 command, words in English),
 * kept per feature in `verification/<id>.txt`. Each of the four count lines
 * must stand exactly once; the line naming the report may be there too.
 */

const LINES = [
  {
    label: 'Statements:',
    pattern: /^Statements: (\d+) verified, (\d+) contradicted, (\d+) misattributed, (\d+) unverifiable$/,
    keys: ['verified', 'contradicted', 'misattributed', 'unverifiable'],
  },
  {
    label: 'Open items:',
    pattern: /^Open items: (\d+) resolved right, (\d+) resolved wrong, (\d+) still open$/,
    keys: ['resolvedRight', 'resolvedWrong', 'stillOpen'],
  },
  {
    label: 'Cross-section conflicts:',
    pattern: /^Cross-section conflicts: (\d+); not checked: (\d+)$/,
    keys: ['conflicts', 'notChecked'],
  },
  {
    label: 'Corrections applied:',
    pattern: /^Corrections applied: (\d+) of (\d+), in .+$/,
    keys: [],
  },
];

/**
 * Parse the reply text.
 * @returns {{ ok: true, counts: object } | { ok: false, reasons: string[] }}
 */
export function parseVerificationReply(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim());
  const counts = {};
  const reasons = [];
  for (const { label, pattern, keys } of LINES) {
    const matches = lines.map((line) => pattern.exec(line)).filter(Boolean);
    if (matches.length !== 1) {
      const started = lines.filter((line) => line.startsWith(label)).length;
      reasons.push(matches.length === 0
        ? `no "${label}" line in the form excavator-verify prints${started > 0 ? ' (a line starts so but does not match)' : ''}`
        : `${matches.length} "${label}" lines`);
      continue;
    }
    keys.forEach((key, at) => { counts[key] = Number(matches[0][at + 1]); });
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, counts };
}
