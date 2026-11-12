/**
 * The glossary of the appendix (openspec change handbook-history-appendix, design
 * D3): the entry names (`where` labels), screen names, state labels with their
 * meanings and roles with what they can do, of the verified entries only, each
 * exact text once, in Unicode code point order. A text that differs in case or
 * spacing is another term; the same concept under two names is not merged. The
 * entries given are the ones the loaded run holds as verified, after the removal
 * of what the verifiers and the tracers did not confirm, so nothing removed is
 * here. Pure and deterministic.
 */

/** The kinds of a term, in the order a term's kinds are listed. */
export const GLOSSARY_KINDS = Object.freeze(['entry', 'screen', 'state', 'role']);

/** The order of two texts by Unicode code point (not by UTF-16 code unit, which puts a character above U+FFFF before U+E000). */
export function compareCodePoints(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const difference = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return x.length - y.length;
}

/**
 * `[{ term, kinds, features, meanings }]` for `rows` (`[{ id, entry }]`, the verified entries in the order of the handbook). `kinds`
 * are the kinds the text has (`GLOSSARY_KINDS` order), `features` the ids of the entries it occurs in, `meanings` the distinct
 * meanings of a state label and the things a role can do, each with the ids of the entries that say it, in the order they were first met.
 */
export function buildGlossary(rows) {
  const terms = new Map();
  const add = (term, kind, id, meaning) => {
    if (typeof term !== 'string' || term === '') return;
    const row = terms.get(term) ?? { term, kinds: new Set(), features: [], meanings: [] };
    terms.set(term, row);
    row.kinds.add(kind);
    if (!row.features.includes(id)) row.features.push(id);
    if (meaning === undefined) return;
    const known = row.meanings.find((one) => one.text === meaning);
    if (known === undefined) row.meanings.push({ text: meaning, features: [id] });
    else if (!known.features.includes(id)) known.features.push(id);
  };
  for (const { id, entry } of rows) {
    for (const place of entry.where) add(place.label, 'entry', id);
    for (const screen of entry.screens) add(screen.name, 'screen', id);
    for (const state of entry.states) add(state.label, 'state', id, state.meaning);
    for (const who of entry.who) add(who.role, 'role', id, who.can);
  }
  return [...terms.values()]
    .sort((a, b) => compareCodePoints(a.term, b.term))
    .map((row) => ({ term: row.term, kinds: GLOSSARY_KINDS.filter((kind) => row.kinds.has(kind)), features: row.features, meanings: row.meanings }));
}
