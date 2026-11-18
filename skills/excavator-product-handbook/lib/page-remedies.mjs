/**
 * The `remedyDomains` key of the page data (openspec change handbook-process-review, design D10, S6c): the items of a remedies chapter
 * that names ids, placed under the business domains they involve, for the improvement suggestions page. An item is a paragraph or list
 * item with its id groups. A D or R id involves the domains of its item's features (the first domain of the page that lists each
 * feature); a P id involves the domain of its process. An item under the level-2 heading of a process is shown under that process
 * (in the process's domain); every other item (the fixed sections of the chapter) is shown under each domain it involves, once, with
 * the problems of that domain only. The items of the section of the defect fixes are the exception: each is in `defectFixes`, once, with every problem it names, and each domain
 * has `covered` (the number of its problems those items name, and the items with their bold label) for a line at the end of its section. An item with no id, or whose ids involve no domain, goes to the `untied` list. The text above the first
 * level-2 heading and the generated section at the end stay in the chapter and are not here. `null` when the chapter names no id, the
 * domains are not usable or there is no chapter, so the page shows the chapter as it is.
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

/** `{ items, domains, untied }` or null; see the file comment. `processes` is the page's `processes` key (null without one). */
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
  const fixes = [];
  const order = domains.list.map((domain) => domain.id);
  const slots = new Map(order.map((id) => [id, { processes: new Map(), sections: new Map() }]));
  const items = [];
  const untied = [];
  for (const item of index.parsed.items) {
    if (item.section === null || item.section.text === generated) continue;
    items.push({ line: item.line, texts: viewTexts(item.text, views) });
    const rows = [...new Set(item.ids.flatMap((id) => (rowOf(id) !== null && rowFeatures.has(rowOf(id)) ? [rowOf(id)] : [])))];
    const process = processSectionId(item.section.text);
    if (process !== null && processDomain.has(process)) {
      const domain = processDomain.get(process);
      if (domain === null) { untied.push({ line: item.line, problems: rows }); continue; }
      const slot = slots.get(domain).processes;
      slot.set(process, [...(slot.get(process) ?? []), { line: item.line, problems: rows }]);
      continue;
    }
    if (item.section.text === defectHeading) {
      fixes.push({ line: item.line, problems: rows, label: /^\*\*([^*]+)\*\*/.exec(item.text)?.[1].trim() ?? '' });
      continue;
    }
    const involved = new Set(item.ids.flatMap((id) => (id.startsWith('P') ? (processDomain.get(id) ?? null) ?? [] : domainsOf(rowFeatures.get(id.toLowerCase()) ?? []))));
    if (involved.size === 0) { untied.push({ line: item.line, problems: rows }); continue; }
    for (const domain of order.filter((id) => involved.has(id))) {
      const own = rows.filter((row) => domainsOf(rowFeatures.get(row)).includes(domain));
      const slot = slots.get(domain).sections;
      slot.set(item.section.text, [...(slot.get(item.section.text) ?? []), { line: item.line, problems: own }]);
    }
  }
  const processOrder = (processes?.items ?? []).map((item) => item.id);
  // For each domain: the distinct problems of it that the defect fixes name, and the fixes that name some.
  const coveredOf = (id) => {
    const named = new Set();
    const lines = [];
    for (const fix of fixes) {
      const own = fix.problems.filter((row) => domainsOf(rowFeatures.get(row)).includes(id));
      own.forEach((row) => named.add(row));
      if (own.length > 0) lines.push({ line: fix.line, label: fix.label });
    }
    return named.size === 0 ? null : { count: named.size, items: lines };
  };
  const used = order.flatMap((id) => {
    const slot = slots.get(id);
    const covered = coveredOf(id);
    if (slot.processes.size === 0 && slot.sections.size === 0 && covered === null) return [];
    return [{
      id,
      ...(covered === null ? {} : { covered }),
      processes: processOrder.filter((process) => slot.processes.has(process)).map((process) => ({ id: process, items: slot.processes.get(process) })),
      sections: [...slot.sections].map(([heading, list]) => ({ heading, items: list })),
    }];
  });
  return { items, domains: used, defectFixes: fixes.length === 0 ? null : { heading: defectHeading, items: fixes.map(({ line, problems }) => ({ line, problems })) }, untied };
}

/**
 * `(line, features) => { anchor, domain? } | null`: where the item that starts on `line` is shown for a row with `features`: under the
 * first domain (in the page's order) of the row's features that has it, else under the first domain that has it, else among the
 * items tied to no domain. The anchor is `remedy-<domain>-<line>` (`remedy-f-<line>` for a defect fix, `remedy-u-<line>` for those tied to no domain), unique per place.
 */
export function remedyPlacer(data, domains) {
  if (data === null) return null;
  const domainsOf = featureDomains(domains);
  const has = (domain, line) => domain.processes.some((process) => process.items.some((item) => item.line === line)) || domain.sections.some((section) => section.items.some((item) => item.line === line));
  return (line, features) => {
    // A defect fix is in one place, its section; the anchor is `remedy-f-<line>`.
    if (data.defectFixes?.items.some((item) => item.line === line) === true) return { anchor: `remedy-f-${line}` };
    const candidates = [...domainsOf(features), ...data.domains.map((domain) => domain.id)];
    for (const id of candidates) {
      const domain = data.domains.find((entry) => entry.id === id);
      if (domain !== undefined && has(domain, line)) return { anchor: `remedy-${id}-${line}`, domain: id };
    }
    return data.untied.some((item) => item.line === line) ? { anchor: `remedy-u-${line}` } : null;
  };
}
