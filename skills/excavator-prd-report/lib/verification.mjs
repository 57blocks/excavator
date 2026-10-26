/**
 * The reply lines of excavator-verify (its Phase 6 command), kept per feature
 * in `verification/<id>.txt`. They are read by position, not by their words,
 * because verify translates its reply under `--language`: the lines that hold
 * standalone integers are the count lines, and there must be four of them, in
 * order, with 4, 3, 2 and 2 integers. The report path that starts the reply,
 * and the document path at the end of the last line, hold no standalone
 * integer (a digit inside a path or a word is not one).
 */

const COUNT_LINES = [
  { label: 'statements', keys: ['verified', 'contradicted', 'misattributed', 'unverifiable'] },
  { label: 'open items', keys: ['resolvedRight', 'resolvedWrong', 'stillOpen'] },
  { label: 'cross-section conflicts', keys: ['conflicts', 'notChecked'] },
  { label: 'corrections applied', keys: [null, null] },
];
const INTEGER = /(?<![\w./\\-])\d+(?![\w./\\-])/g;

/**
 * Parse the reply text.
 * @returns {{ ok: true, counts: object } | { ok: false, reasons: string[] }}
 */
export function parseVerificationReply(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
    .map((line) => (line.match(INTEGER) ?? []).map(Number))
    .filter((integers) => integers.length > 0);
  if (lines.length !== COUNT_LINES.length) return { ok: false, reasons: [`${lines.length} lines hold counts, not ${COUNT_LINES.length}`] };
  const counts = {};
  const reasons = [];
  COUNT_LINES.forEach(({ label, keys }, at) => {
    const integers = lines[at];
    if (integers.length !== keys.length) {
      reasons.push(`count line ${at + 1} (${label}) holds ${integers.length} integers, not ${keys.length}`);
      return;
    }
    keys.forEach((key, k) => { if (key !== null) counts[key] = integers[k]; });
  });
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, counts };
}
