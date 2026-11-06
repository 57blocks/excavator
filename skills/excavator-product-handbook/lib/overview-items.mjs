/**
 * The items and the claims of a system overview (openspec change
 * handbook-system-overview), in the shapes items.mjs and claims.mjs give for a
 * feature entry, so the review, the verifiers and the tracers treat both the
 * same way. An item is a node that carries evidence, named by its JSON path
 * (`name`, `summary[0]`, `audiences[1]`, `applications[0]`, `integrations[2]`).
 * The name (openspec change handbook-system-name) is quoted from the code like
 * a label: its text must occur in its own citation, and it is no narrative, so
 * neither the language check nor the banned-words gate holds it to the run's
 * language or to plain words. A null or absent name is no item.
 *
 * `who`, `does`, `name`, `use` and `summary.text` are narrative; `system` is a
 * label that must occur in its own item's citations. `dir` and `callers` are
 * project directories, not reader text, so they are no string of an item and
 * the banned-words gate does not read them. `unknowns` say what is not known:
 * no evidence, no number check.
 */

import { itemOf, textOf } from './items.mjs';
import { fill } from './ui.mjs';

const SEP = ' > ';

/** The items of an overview that passed the shape check. */
export function overviewItems(doc) {
  const items = [];
  if (doc.name !== undefined && doc.name !== null) items.push(itemOf('name', [textOf('name.text', doc.name.text, { label: true })], doc.name.evidence));
  doc.summary.forEach((entry, i) => {
    items.push(itemOf(`summary[${i}]`, [textOf(`summary[${i}].text`, entry.text, { narrative: true })], entry.evidence));
  });
  doc.audiences.forEach((entry, i) => {
    const path = `audiences[${i}]`;
    items.push(itemOf(path, [textOf(`${path}.who`, entry.who, { narrative: true }), textOf(`${path}.does`, entry.does, { narrative: true })], entry.evidence));
  });
  doc.applications.forEach((entry, i) => {
    const path = `applications[${i}]`;
    items.push(itemOf(path, [textOf(`${path}.name`, entry.name, { narrative: true }), textOf(`${path}.does`, entry.does, { narrative: true })], entry.evidence));
  });
  doc.integrations.forEach((entry, i) => {
    const path = `integrations[${i}]`;
    items.push(itemOf(path, [textOf(`${path}.system`, entry.system, { label: true }), textOf(`${path}.use`, entry.use, { narrative: true })], entry.evidence));
  });
  doc.unknowns.forEach((entry, i) => {
    const path = `unknowns[${i}]`;
    items.push(itemOf(path, [textOf(`${path}.item`, entry.item, { numbers: false, narrative: true }), textOf(`${path}.searched`, entry.searched, { numbers: false, narrative: true })], undefined));
  });
  return items;
}

/** A Map from item path to claim for every item of an overview that carries evidence; the connecting words are the run's fixed texts. */
export function overviewClaims(doc, ui) {
  const t = (key) => {
    if (!Object.hasOwn(ui, key)) throw new Error(`the fixed-text table has no key ${key}`);
    return ui[key];
  };
  const claims = new Map();
  if (doc.name !== undefined && doc.name !== null) claims.set('name', [t('md.overview.systemName'), doc.name.text].join(SEP));
  doc.summary.forEach((entry, i) => claims.set(`summary[${i}]`, [t('md.overview.heading'), t('md.section.purpose'), entry.text].join(SEP)));
  doc.audiences.forEach((entry, i) => claims.set(`audiences[${i}]`, `${t('md.table.who')}: ${entry.who}; ${t('md.table.does')}: ${entry.does}`));
  doc.applications.forEach((entry, i) => {
    claims.set(`applications[${i}]`, [fill(t('md.overview.application.item'), { dir: entry.dir, name: entry.name }), entry.does].join(SEP));
  });
  doc.integrations.forEach((entry, i) => {
    claims.set(`integrations[${i}]`, `${t('md.table.system')}: ${entry.system}; ${t('md.table.use')}: ${entry.use}; ${t('md.table.callers')}: ${entry.callers.join(', ')}`);
  });
  return claims;
}

/** Remove the items of the path set `removed` from an overview; nothing hangs on an overview item, so nothing goes with them. Returns `{ entry, together }`. */
export function trimOverview(doc, removed) {
  const out = structuredClone(doc);
  // A removed name leaves no key, like a feature entry's removed purpose.
  if (removed.has('name')) delete out.name;
  for (const key of ['summary', 'audiences', 'applications', 'integrations']) out[key] = doc[key].filter((_, i) => !removed.has(`${key}[${i}]`));
  return { entry: out, together: [] };
}
