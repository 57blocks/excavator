// The excavator-verify reply lines kept in verification/<id>.txt (openspec
// change prd-feature-pipeline, design D5): read by position and by the count
// of integers on each line, so a reply translated under --language parses too.
import { describe, expect, it } from 'vitest';

import { parseVerificationReply } from '../../../skills/excavator-prd-report/lib/verification.mjs';

const COUNTS = {
  verified: 7, contradicted: 2, misattributed: 1, unverifiable: 3,
  resolvedRight: 2, resolvedWrong: 1, stillOpen: 4, conflicts: 1, notChecked: 5,
};
const ENGLISH = [
  '/tmp/out2/verification/F12.md',
  'Statements: 7 verified, 2 contradicted, 1 misattributed, 3 unverifiable',
  'Open items: 2 resolved right, 1 resolved wrong, 4 still open',
  'Cross-section conflicts: 1; not checked: 5',
  'Corrections applied: 4 of 4, in /tmp/out2/features/F12.md',
].join('\n');

describe('parseVerificationReply', () => {
  it('reads the counts of the English reply, not the digits of its paths', () => {
    expect(parseVerificationReply(`${ENGLISH}\n`)).toEqual({ ok: true, counts: COUNTS });
  });

  it('reads a translated reply the same way', () => {
    const cjk = (...points) => String.fromCodePoint(...points);
    const german = [
      '/tmp/out2/verification/F12.md',
      'Aussagen: 7 bestaetigt, 2 widerlegt, 1 falsch zugeordnet, 3 nicht pruefbar',
      'Offene Punkte: 2 richtig geklaert, 1 falsch geklaert, 4 noch offen',
      'Widersprueche zwischen Abschnitten: 1; nicht geprueft: 5',
      'Korrekturen angewendet: 4 von 4, in /tmp/out2/features/F12.md',
    ].join('\n');
    expect(parseVerificationReply(german)).toEqual({ ok: true, counts: COUNTS });
    const chinese = [
      '/tmp/out2/verification/F12.md',
      `${cjk(0x9648, 0x8ff0)}${cjk(0xff1a)}7 ${cjk(0x5df2)}, 2 ${cjk(0x77db)}, 1 ${cjk(0x9519)}, 3 ${cjk(0x672a)}`,
      `${cjk(0x5f85, 0x786e, 0x8ba4)}${cjk(0xff1a)}2${cjk(0x5bf9)}${cjk(0xff0c)}1${cjk(0x9519)}${cjk(0xff0c)}4${cjk(0x672a)}`,
      `${cjk(0x51b2, 0x7a81)}${cjk(0xff1a)}1${cjk(0xff1b)}5`,
      `${cjk(0x4fee, 0x6b63)}${cjk(0xff1a)}4 / 4${cjk(0xff0c)}/tmp/out2/features/F12.md`,
    ].join('\n');
    expect(parseVerificationReply(chinese)).toEqual({ ok: true, counts: COUNTS });
  });

  it('fails a reply with a count line missing', () => {
    const text = ENGLISH.split('\n').filter((line) => !line.startsWith('Open items')).join('\n');
    expect(parseVerificationReply(text)).toEqual({ ok: false, reasons: ['3 lines hold counts, not 4'] });
  });

  it('fails a line with the wrong number of integers, naming it', () => {
    const text = ENGLISH.replace('3 unverifiable', 'unverifiable');
    expect(parseVerificationReply(text)).toEqual({ ok: false, reasons: ['count line 1 (statements) holds 3 integers, not 4'] });
  });

  it('fails the lines in another order', () => {
    const lines = ENGLISH.split('\n');
    const swapped = [lines[0], lines[2], lines[1], lines[3], lines[4]].join('\n');
    const result = parseVerificationReply(swapped);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual([
      'count line 1 (statements) holds 3 integers, not 4',
      'count line 2 (open items) holds 4 integers, not 3',
    ]);
  });

  it('fails an empty reply', () => {
    expect(parseVerificationReply('')).toEqual({ ok: false, reasons: ['0 lines hold counts, not 4'] });
  });
});
