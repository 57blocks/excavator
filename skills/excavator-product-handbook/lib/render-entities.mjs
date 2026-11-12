/**
 * The entity sections and the matrices of handbook.md (openspec change
 * handbook-entities-and-views, design D2, D3, D4), written from the computed
 * entities (entities.mjs) and the verified entries, one function for each block
 * the outline places (outline.mjs, render.mjs); the technical view adds the
 * source positions of each item. Every heading, header and note is a fixed
 * text, and each says only what was checked: the same relation names as the
 * page. Pure and deterministic.
 */

import { inline, table } from './markdown.mjs';
import { FACT_KEYS, applicationCells } from './render-application.mjs';
import { fill } from './ui.mjs';

/** A feature as the tables name it: its id and name, so two features with one name stay apart. */
const featureText = (feature, t) => fill(t('md.summary.feature'), { id: feature.id, name: feature.name });

const bullets = (items, t) => (items.length === 0 ? [t('md.none'), ''] : [...items.map((item) => `- ${inline(item)}`), '']);

/** A label inside a mermaid node or edge: one line, no double quote. */
export const label = (text) => inline(text).replace(/"/g, "'").replace(/\s+/g, ' ');

/** A mermaid flowchart, left to right, of nodes (labels) and edges (indexes, with an optional label), in a fenced block. */
const flowchart = (prefixes, edges) => [
  '```mermaid',
  'flowchart LR',
  ...prefixes.flatMap(([prefix, names]) => names.map((name, at) => `  ${prefix}${at}["${label(name)}"]`)),
  ...edges.map((edge) => `  ${edge.from} -->${edge.label === undefined ? '' : `|"${label(edge.label)}"|`} ${edge.to}`),
  '```',
  '',
];

/** handbook-domain-page D4: the domains with a flow, and one edge for each flow labelled with its count; a fixed text when there is none. */
export function flowDiagram(entities, t) {
  const out = [`### ${t('md.entities.domains.flowHeading')}`, ''];
  const flows = entities.domainFlows ?? [];
  if (flows.length === 0) return [...out, t('md.entities.domains.flowNone'), ''];
  const drawn = entities.domains.filter((domain) => flows.some((flow) => flow.from === domain.id || flow.to === domain.id));
  const index = new Map(drawn.map((domain, at) => [domain.id, `D${at}`]));
  return [...out, t('md.entities.domains.flowNote'), '', ...flowchart([['D', drawn.map((domain) => domain.name)]], flows.map((flow) => ({ from: index.get(flow.from), to: index.get(flow.to), label: String(flow.count) })))];
}

/** handbook-domain-page D5: the applications and the external systems the verified overview shows them calling; a fixed text when there is none. */
export function structureDiagram(entities, t) {
  const out = [`### ${t('md.entities.systems.diagramHeading')}`, ''];
  const systems = entities.integrations.filter((item) => item.shown.length > 0);
  if (systems.length === 0) return [...out, t('md.entities.systems.diagramNone'), ''];
  const applications = [...new Set(systems.flatMap((item) => item.shown))];
  const edges = systems.flatMap((item) => item.shown.map((caller) => ({ from: `A${applications.indexOf(caller)}`, to: `S${systems.indexOf(item)}` })));
  return [...out, t('md.entities.systems.diagramNote'), '', ...flowchart([['A', applications], ['S', systems.map((item) => item.system)]], edges)];
}

/**
 * The flow diagram of a domain (openspec change handbook-free-chapter, D8) as a mermaid flowchart of the checked nodes and edges, with its note;
 * the fixed text that it failed its checks when it did, and the fixed none text for a domain with no diagram.
 */
function domainFlowLines(domain, t) {
  const out = [`#### ${t('md.entities.domain.flowHeading')}`, ''];
  const { flow } = domain;
  if (flow === undefined) return [...out, t('md.entities.domain.flowNone'), ''];
  if (flow.status === 'failed') return [...out, t('md.entities.domain.flowFailed'), ''];
  const index = new Map(flow.nodes.map((node, at) => [node.id, `N${at}`]));
  return [...out, t('md.entities.domain.flowNote'), '', ...flowchart([['N', flow.nodes.map((node) => node.label)]], flow.edges.map((edge) => ({ from: index.get(edge.from), to: index.get(edge.to), label: edge.text })))];
}

/**
 * The domains as the handbook shows them: the notes of the chapter and, for each domain, what it does and its handoffs
 * to and from other domains (handbook-domain-page D1), from the verified entries only, and, right after what it does, its flow diagram (domain-flows-check.mjs). The business flow diagram is a block of its own.
 */
export function domainParts({ map, entities, t }) {
  const feature = new Map(map.features.map((item) => [item.id, item]));
  const nameOf = new Map(entities.domains.map((domain) => [domain.id, domain.name]));
  const intro = [t(entities.domainBasis === 'domains' ? 'md.entities.domains.note' : 'md.domains.fromAreas'), '', t('md.entities.domains.purposesNote'), '', t('md.entities.domain.relationsNote'), ''];
  const each = entities.domains.map((domain) => {
    const out = [`#### ${t('md.entities.domain.whatItDoes')}`, ''];
    out.push(...bullets(domain.purposes.map((item) => fill(t('md.entities.domain.purposeItem'), { feature: featureText(feature.get(item.feature), t), purpose: inline(item.text) })), t));
    out.push(...domainFlowLines(domain, t));
    out.push(`#### ${t('md.entities.domain.relationsHeading')}`, '');
    for (const [label, direction] of [['md.entities.domain.gives', 'out'], ['md.entities.domain.gets', 'in']]) {
      const items = (domain.relations ?? []).filter((item) => item.direction === direction);
      out.push(t(label), '');
      out.push(...bullets(items.map((item) => fill(t('md.entities.domain.relationItem'), { from: featureText(feature.get(item.from), t), to: featureText(feature.get(item.to), t), domain: nameOf.get(item.domain), text: item.text })), t));
    }
    return { id: domain.id, lines: out };
  });
  return { intro, domains: each };
}

export function rolesSection({ map, entities, t }) {
  const feature = new Map(map.features.map((item) => [item.id, item]));
  const out = [`## ${t('md.entities.roles.heading')}`, '', t('md.entities.roles.note'), ''];
  for (const role of entities.roles) {
    out.push(`### ${inline(role.label)}`, '');
    const cells = entities.matrices.roleFeature.cells.filter((cell) => cell.role === role.label);
    out.push(...bullets(cells.map((cell) => fill(t('md.entities.role.item'), { feature: featureText(feature.get(cell.feature), t), can: cell.can.map(inline).join(' ') })), t));
  }
  return out;
}

export function roleFeatureMatrix({ map, entities, t }) {
  const { roles, features, cells } = entities.matrices.roleFeature;
  const feature = new Map(map.features.map((item) => [item.id, item]));
  const out = [`## ${t('md.matrix.roleFeature.heading')}`, '', t('md.matrix.roleFeature.note'), ''];
  if (roles.length === 0 || features.length === 0) return [...out, t('md.none'), ''];
  const cellOf = (role, id) => (cells.find((cell) => cell.role === role && cell.feature === id)?.can ?? []).map(inline).join('<br>');
  out.push(table([t('md.table.role'), ...features.map((id) => featureText(feature.get(id), t))], roles.map((role) => [role, ...features.map((id) => cellOf(role, id))])), '');
  return out;
}

export function applicationsSection({ map, entities, summary, system, t }) {
  const feature = new Map(map.features.map((item) => [item.id, item]));
  const domain = new Map(entities.domains.map((item) => [item.id, item]));
  const reasonOf = new Map(summary.jobs.map((job) => [job.candidate, job.reason]));
  const facts = new Map(system.applications.map((application) => [application.dir, applicationCells(application, t)]));
  const out = [`## ${t('md.entities.applications.heading')}`, '', t('md.entities.applications.note'), ''];
  if (entities.applications.length === 0) out.push(t('md.none'), '');
  for (const application of entities.applications) {
    const { dir } = application;
    const cells = facts.get(dir);
    out.push(`### ${inline(dir)}`, '');
    out.push(`- ${inline(application.name === null ? t('md.overview.notVerified') : fill(t('md.entities.app.what'), { name: cells[1], does: cells[2] }))}`);
    FACT_KEYS.forEach((key, index) => out.push(`- ${inline(fill(t('md.entities.fact'), { label: t(key), value: cells[3 + index] }))}`));
    out.push('');
    const inFeatures = entities.relations.featureApplication.filter((row) => row.application === dir);
    out.push(`#### ${t('md.entities.app.featuresHeading')}`, '');
    out.push(inFeatures.length === 0 ? t('md.none') : table([t('md.table.feature'), t('md.table.citations')], inFeatures.map((row) => [featureText(feature.get(row.feature), t), String(row.citations)])), '');
    const inDomains = entities.matrices.applicationDomain.cells.filter((cell) => cell.application === dir);
    out.push(`#### ${t('md.entities.app.domainsHeading')}`, '');
    out.push(inDomains.length === 0 ? t('md.none') : table([t('md.table.domain'), t('md.table.citations')], inDomains.map((cell) => [domain.get(cell.domain).name, String(cell.citations)])), '');
    const jobs = entities.jobs.filter((job) => job.application === dir);
    out.push(`#### ${t('md.entities.app.jobsHeading')}`, '');
    out.push(jobs.length === 0
      ? t('md.none')
      : table([t('md.table.candidate'), t('md.table.feature')], jobs.map((job) => [job.candidate, job.feature === null ? fill(t('md.summary.unassigned'), { reason: reasonOf.get(job.candidate) }) : featureText(feature.get(job.feature), t)])), '');
    out.push(`#### ${t('md.entities.app.shownHeading')}`, '', ...bullets(entities.integrations.filter((item) => item.shown.includes(dir)).map((item) => item.system), t));
    out.push(`#### ${t('md.entities.app.namedHeading')}`, '');
    const named = entities.integrations.flatMap((item) => item.named.filter((entry) => entry.application === dir).map((entry) => fill(t('md.entities.app.namedItem'), { system: item.system, files: entry.files })));
    out.push(...bullets(named, t));
  }
  out.push(`### ${t('md.entities.unattributed.heading')}`, '', t('md.entities.unattributed.note'), '');
  const { unattributed } = entities.relations;
  out.push(unattributed.length === 0 ? t('md.none') : table([t('md.table.feature'), t('md.table.citations')], unattributed.map((row) => [featureText(feature.get(row.feature), t), String(row.citations)])), '');
  return out;
}

export function systemsSection({ entities, t }) {
  const out = [`## ${t('md.entities.systems.heading')}`, '', t('md.entities.systems.note'), ''];
  if (entities.integrations.length === 0) out.push(t('md.none'), '');
  for (const item of entities.integrations) {
    out.push(`### ${inline(item.system)}`, '', `- ${inline(fill(t('md.entities.fact'), { label: t('md.table.use'), value: item.use }))}`, '');
    out.push(`#### ${t('md.table.callers')}`, '', ...bullets(item.shown, t));
    out.push(`#### ${t('md.entities.system.named')}`, '', ...bullets(item.named.map((entry) => fill(t('md.entities.system.namedItem'), { application: entry.application, files: entry.files })), t));
    out.push(fill(t('md.entities.system.namedOutside'), { count: item.namedOutside }), '');
  }
  return out;
}

export function applicationDomainMatrix({ entities, t }) {
  const { applications, domains, cells, unattributed } = entities.matrices.applicationDomain;
  const name = new Map(entities.domains.map((item) => [item.id, item.name]));
  const out = [`## ${t('md.matrix.applicationDomain.heading')}`, '', t('md.matrix.applicationDomain.note'), ''];
  if (applications.length === 0 && unattributed.length === 0) return [...out, t('md.none'), ''];
  const cellOf = (application, id) => String(cells.find((cell) => cell.application === application && cell.domain === id)?.citations ?? '');
  const rows = applications.map((application) => [application, ...domains.map((id) => cellOf(application, id))]);
  rows.push([t('md.matrix.applicationDomain.outside'), ...domains.map((id) => String(unattributed.find((row) => row.domain === id)?.citations ?? ''))]);
  out.push(table([t('md.table.application'), ...domains.map((id) => name.get(id))], rows), '');
  return out;
}

const placeText = (citation, t) => {
  if (citation.startLine === null) return fill(t('md.locations.unlocated'), { file: citation.file });
  if (citation.startLine === citation.endLine) return fill(t('md.locations.placeOne'), { file: citation.file, line: citation.startLine });
  return fill(t('md.locations.place'), { file: citation.file, start: citation.startLine, end: citation.endLine });
};

/** The source positions of one unit: one line per item with its claim and the file and lines of each passage. */
export function locationLines(unit, t) {
  return bullets(unit.items.map((item) => fill(t('md.locations.item'), { claim: inline(item.claim), places: item.citations.map((citation) => placeText(citation, t)).join('; ') })), t);
}
