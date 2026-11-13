/**
 * The items of a map (design D4, D5, D8): each node that carries
 * evidence, with its own reader-visible strings. An item is
 *
 *   { path, strings, evidence, passages }
 *
 * where `strings` are `{ path, text, label, numbers }` (`label`: the text must
 * occur in the item's passages; `numbers`: its numbers must), `evidence` the
 * citations to resolve (`{ path, file, passage }`) and `passages` the texts
 * the value checks read (`source` names where they come from when the item
 * has no citation of its own). Reader-visible strings are everything except
 * evidence, ids, reach, side, area, candidates, seedFiles, format and language.
 * `narrative` marks the text a model writes in the run's language (the
 * language check, language-check.mjs, reads it): everything reader-visible
 * except a label, a screen name, a `where` label and `who.role`, which are
 * quoted from the source or the map; an area name that carries evidence and a
 * feature name next to a label are quoted too.
 * `unknowns` and unassigned reasons say what is not known or why a candidate
 * is left out; they state no fact from the source, so they have no passages
 * and skip the number check but still pass the banned-words gate. A role in
 * `who` is checked against the map's roles instead of the item's passages.
 */

const text = (path, value, { label = false, numbers = true, narrative = false } = {}) => ({ path, text: value, label, numbers, narrative });

function evidenceOf(path, list) {
  return (list ?? []).map((entry, index) => ({ path: `${path}.evidence[${index}]`, file: entry.file, passage: entry.passage }));
}

function item(path, strings, list) {
  const evidence = evidenceOf(path, list);
  return { path, strings, evidence, passages: evidence.map((entry) => entry.passage) };
}

/** The items of a map that passed the shape check. */
export function mapItems(map) {
  const items = [];
  map.areas.forEach((area, i) => {
    items.push(item(`areas[${i}]`, [text(`areas[${i}].name`, area.name, { label: area.evidence !== undefined, narrative: area.evidence === undefined })], area.evidence));
  });
  map.features.forEach((feature, i) => {
    const base = `features[${i}]`;
    const strings = [text(`${base}.name`, feature.name, { narrative: feature.label === undefined })];
    if (feature.label !== undefined) strings.push(text(`${base}.label`, feature.label, { label: true }));
    items.push(item(base, strings, feature.evidence));
  });
  map.unassigned.forEach((entry, i) => {
    items.push(item(`unassigned[${i}]`, [text(`unassigned[${i}].reason`, entry.reason, { numbers: false, narrative: true })], undefined));
  });
  for (const group of ['roles', 'names']) {
    map[group].forEach((entry, i) => {
      items.push(item(`${group}[${i}]`, [text(`${group}[${i}].label`, entry.label, { label: true })], entry.evidence));
    });
  }
  return items;
}
