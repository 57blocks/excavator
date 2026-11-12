/**
 * The language check (design D12): a prompt that says "write in <language>"
 * did not keep a real run's narrative out of English, so a script checks it.
 * A run whose language is not English and whose fixed-text table (ui.json)
 * is mostly written in letters outside ASCII is a run in a language with its
 * own script; there, each narrative text a model wrote must hold at least one
 * letter outside ASCII. A language written in Latin letters (French, Spanish)
 * cannot be told apart from English this way and is not checked: for those
 * the narrative language rests on the prompt alone, a known limit.
 *
 * `languageGate` decides the mode of a run: `{ ok: true, check: { language } }`
 * for the script check, `{ ok: true, check: null }` for no check, or
 * `{ ok: false, lines }` when a non-English run has no usable ui.json. The
 * checked texts are the items' `narrative` strings (items.mjs); `reviewItems`
 * applies `narrativeProblem` (narrative.mjs) to them with the labels it
 * already exempts from the banned-words gate.
 */

import { join } from 'node:path';

import { readJson } from './json-file.mjs';
import { NON_ASCII_LETTER } from './narrative.mjs';
import { checkUi, isEnglish, UI_FILE } from './ui.mjs';

/** At least half of the table's values must hold a letter outside ASCII for the language to count as having its own script. */
function hasOwnScript(strings) {
  const values = Object.values(strings);
  return values.length > 0 && values.filter((value) => NON_ASCII_LETTER.test(value)).length * 2 >= values.length;
}

/** The mode of the run whose map is `map`, read from `<out>/ui.json` when the language is not English. */
export function languageGate(outDir, map) {
  const language = map?.language;
  // A map without a usable language is a shape problem, which the map check reports.
  if (typeof language !== 'string' || language.trim() === '' || isEnglish(language)) return { ok: true, check: null };
  const checked = checkUi(outDir);
  if (checked.status !== 0) {
    return {
      ok: false,
      lines: [
        `${checked.lines[0]}; the narrative language check of a ${language} run needs a checked ${UI_FILE}`,
        `Next: write ${UI_FILE} first (the fixed-text phase: translate the table, then run check-ui until it passes) and run this command again`,
      ],
    };
  }
  const strings = readJson(join(outDir, UI_FILE)).value.strings;
  return { ok: true, check: hasOwnScript(strings) ? { language } : null };
}
