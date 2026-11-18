/**
 * The `remedyDomains` key of the page data (openspec change handbook-process-review, design D10, S6e): the items of a remedies chapter
 * that names ids, in groups by measure type and, inside a group, under the business domains they involve, for the improvement
 * suggestions page. An item is a paragraph or list item with its id groups. The group comes from the item's leading bold type word,
 * compared with the run's `chapter.remedies.type.*` texts: `simplify` (merge entrance, remove step, retire old), `unify`, `automate`,
 * `defects` (every item of the section of the defect fixes, which are the category items, and the type fix) and `other` for a label
 * that is no type, outside the section of the defect fixes. A D or R id involves the domains of its item's features (the first domain of
 * the page that lists each feature); a P id involves the domain of its process. An item under the level-2 heading of a process is
 * shown under that process's domain (its ref has `process`); every other item is shown under each domain it involves, once each, with
 * the problems of that domain only. The category items of the defect fixes are in `across` of the `defects` group, once, with every
 * problem they name, and each domain of that group has `covered` (the number of its problems those items name, and the items with their
 * bold label) for a line at its end. An item with no id, or whose ids involve no domain, goes to the `untied` list of its group. A ref
 * has `bare` when the item's type word is left out of its text (the group has one type, or the item is a plain fix). `count` is the
 * number of distinct items of a group. `generated` is the number of problems the generated section at the end lists (null when it
 * lists none). The text above the first level-2 heading and the generated section stay in the chapter and are not in `items`. `null`
 * when the chapter names no id, the domains are not usable or there is no chapter, so the page shows the chapter as it is.
 */

import { runNumbers } from './item-numbers.mjs';
import { viewTexts } from './page-domains.mjs';
import { remedyIndex } from './page-problems.mjs';
import { processSectionId } from './remedies-parse.mjs';

/** The id of a problem row (`d3`, `r12`) of a D or R id of an id group, or null for a P id. */
const rowOf = (id) => (id.startsWith('P') ? null : id.toLowerCase());

/** `domainsOfFeatures(features)`: the page ids of the domains that list some of `features`, in the page's order, each once. */
function featureDomains(domains) {
  const first = new Map();
  for (const domain of domains.list) for (const feature of domain.features) if (!first.has(feature)) first.set(feature, domain.id);
  const order = domains.list.map((domain) => domain.id);
  return (features) => {
    const found = new Set(features.flatMap((feature) => (first.has(feature) ? [first.get(feature)] : [])));
    return order.filter((id) => found.has(id));
  };
}

/** The groups of the page in order, and the measure types (the end of the key `chapter.remedies.type.<type>`) each holds. */
export const REMEDY_GROUPS = Object.freeze({
  simplify: ['merge-entrance', 'remove-step', 'retire-old'],
  unify: ['unify-rule'],
  automate: ['automate'],
  defects: ['fix'],
  other: [],
});

const LEADING_BOLD = /^\*\*([^*]+)\*\*/;

/** `{ items, groups, generated }` or null; see the file comment. `processes` is the page's `processes` key (null without one). */
export function remedyDomainsData(run, views, { domains, processes }) {
  const index = remedyIndex(run, views);
  if (index === null || !index.numbered || domains.state !== 'ok') return null;
  const numbers = runNumbers(run);
  const rowFeatures = new Map([
    ...numbers.defects.items.map((entry) => [`d${entry.n}`, entry.features]),
    ...numbers.design.items.map((entry) => [`r${entry.n}`, entry.features]),
  ]);
  const domainsOf = featureDomains(domains);
  const processDomain = new Map((processes?.items ?? []).map((item) => [item.id, item.domain ?? null]));
  const generated = run.ui['chapter.remedies.uncovered'];
  const defectHeading = run.ui['chapter.remedies.defectFixes'];
  const order = domains.list.map((domain) => domain.id);
  // The group of a type word: the one whose types have this text in the run's table.
  const groupOf = new Map();
  for (const [group, types] of Object.entries(REMEDY_GROUPS)) for (const type of types) groupOf.set(run.ui[`chapter.remedies.type.${type}`], group);
  const slots = new Map(Object.keys(REMEDY_GROUPS).map((id) => [id, { across: [], domains: new Map(order.map((domain) => [domain, []])), untied: [], lines: new Set() }]));
  const items = [];
  let listed = 0;
  for (const item of index.parsed.items) {
    if (item.section === null) continue;
    if (item.section.text === generated) {
      if (/^[DR]\d+\s/.test(item.text)) listed += 1;
      continue;
    }
    items.push({ line: item.line, texts: viewTexts(item.text, views) });
    const rows = [...new Set(item.ids.flatMap((id) => (rowOf(id) !== null && rowFeatures.has(rowOf(id)) ? [rowOf(id)] : [])))];
    const label = LEADING_BOLD.exec(item.text)?.[1].trim() ?? '';
    const category = item.section.text === defectHeading;
    const group = category ? 'defects' : groupOf.get(label) ?? 'other';
    const slot = slots.get(group);
    slot.lines.add(item.line);
    if (category) { slot.across.push({ line: item.line, problems: rows, label }); continue; }
    const bare = group === 'unify' || group === 'automate' || group === 'defects' ? { bare: true } : {};
    const process = processSectionId(item.section.text);
    if (process !== null && processDomain.has(process)) {
      const domain = processDomain.get(process);
      const ref = { line: item.line, problems: rows, process, ...bare };
      if (domain === null) slot.untied.push(ref);
      else slot.domains.get(domain).push(ref);
      continue;
    }
    const involved = new Set(item.ids.flatMap((id) => (id.startsWith('P') ? (processDomain.get(id) ?? null) ?? [] : domainsOf(rowFeatures.get(id.toLowerCase()) ?? []))));
    if (involved.size === 0) { slot.untied.push({ line: item.line, problems: rows, ...bare }); continue; }
    for (const domain of order.filter((id) => involved.has(id))) {
      const own = rows.filter((row) => domainsOf(rowFeatures.get(row)).includes(domain));
      slot.domains.get(domain).push({ line: item.line, problems: own, ...bare });
    }
  }
  // For each domain of the defects group: the distinct problems of it that the category items name, and the items that name some.
  const coveredOf = (id) => {
    const named = new Set();
    const lines = [];
    for (const fix of slots.get('defects').across) {
      const own = fix.problems.filter((row) => domainsOf(rowFeatures.get(row)).includes(id));
      own.forEach((row) => named.add(row));
      if (own.length > 0) lines.push({ line: fix.line, label: fix.label });
    }
    return named.size === 0 ? null : { count: named.size, items: lines };
  };
  const groups = Object.keys(REMEDY_GROUPS).flatMap((id) => {
    const slot = slots.get(id);
    if (slot.lines.size === 0) return [];
    const domainList = order.flatMap((domain) => {
      const refs = slot.domains.get(domain);
      const covered = id === 'defects' ? coveredOf(domain) : null;
      return refs.length === 0 && covered === null ? [] : [{ id: domain, items: refs, ...(covered === null ? {} : { covered }) }];
    });
    return [{ id, count: slot.lines.size, across: slot.across.map(({ line, problems }) => ({ line, problems })), domains: domainList, untied: slot.untied }];
  });
  return { items, groups, generated: listed === 0 ? null : listed };
}

/**
 * `(line, features) => { anchor, tab, domain? } | null`: where the item that starts on `line` is shown for a row with `features`: in
 * its group's tab, among the category items (`across`) of the defect fixes, else under the first domain (in the page's order) of the
 * row's features that has it, else under the first domain that has it, else among the items tied to no domain. The anchor is
 * `remedy-<group>-<domain>-<line>` (`a` for the category items, `u` for those tied to no domain), unique per tab, place and item.
 */
export function remedyPlacer(data, domains) {
  if (data === null) return null;
  const domainsOf = featureDomains(domains);
  return (line, features) => {
    const group = data.groups.find((entry) => entry.across.some((item) => item.line === line) || entry.untied.some((item) => item.line === line) || entry.domains.some((domain) => domain.items.some((item) => item.line === line)));
    if (group === undefined) return null;
    if (group.across.some((item) => item.line === line)) return { anchor: `remedy-${group.id}-a-${line}`, tab: group.id };
    const has = (domain) => domain.items.some((item) => item.line === line);
    const candidates = [...domainsOf(features), ...group.domains.map((domain) => domain.id)];
    for (const id of candidates) {
      const domain = group.domains.find((entry) => entry.id === id);
      if (domain !== undefined && has(domain)) return { anchor: `remedy-${group.id}-${id}-${line}`, tab: group.id, domain: id };
    }
    return { anchor: `remedy-${group.id}-u-${line}`, tab: group.id };
  };
}
