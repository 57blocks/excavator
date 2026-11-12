/**
 * The entity sections and the matrices of handbook.md (openspec change
 * handbook-entities-and-views, design D2, D3, D4), written from the computed
 * entities (entities.mjs) and the verified entries. Both views have the
 * domains, the roles and the roles-by-feature matrix; the technical view adds
 * the applications, the external systems, the applications-by-domain matrix and
 * the source positions of each item. Every heading, header and note is a fixed
 * text, and each says only what was checked: the same relation names as the
 * page. Pure and deterministic.
 */

import { inline, table } from './markdown.mjs';
import { FACT_KEYS, applicationCells } from './render-application.mjs';
import { fill } from './ui.mjs';

/** A feature as the tables name it: its id and name, so two features with one name stay apart. */
const featureText = (feature, t) => fill(t('md.summary.feature'), { id: feature.id, name: feature.name });

const bullets = (items, t) => (items.length === 0 ? [t('md.none'), ''] : [...items.map((item) => `- ${inline(item)}`), '']);

function domainsSection({ map, entities, t }) {
  const verified = new Set(entities.matrices.roleFeature.features);
  const feature = new Map(map.features.map((item) => [item.id, item]));
  const out = [`## ${t('md.entities.domains.heading')}`, '', t(entities.domainBasis === 'domains' ? 'md.entities.domains.note' : 'md.domains.fromAreas'), '', t('md.entities.domains.purposesNote'), ''];
  for (const domain of entities.domains) {
    out.push(`### ${inline(domain.name)}`, '', fill(t('md.entities.domain.counts'), { features: domain.features.length, verified: domain.features.filter((id) => verified.has(id)).length }), '');
    out.push(`#### ${t('md.entities.domain.whatItDoes')}`, '');
    out.push(...bullets(domain.purposes.map((item) => fill(t('md.entities.domain.purposeItem'), { feature: featureText(feature.get(item.feature), t), purpose: inline(item.text) })), t));
  }
  return out;
}

function rolesSection({ map, entities, t }) {
  const feature = new Map(map.features.map((item) => [item.id, item]));
  const out = [`## ${t('md.entities.roles.heading')}`, '', t('md.entities.roles.note'), ''];
  for (const role of entities.roles) {
    out.push(`### ${inline(role.label)}`, '');
    const cells = entities.matrices.roleFeature.cells.filter((cell) => cell.role === role.label);
    out.push(...bullets(cells.map((cell) => fill(t('md.entities.role.item'), { feature: featureText(feature.get(cell.feature), t), can: cell.can.map(inline).join(' ') })), t));
  }
  return out;
}

function roleFeatureMatrix({ map, entities, t }) {
  const { roles, features, cells } = entities.matrices.roleFeature;
  const feature = new Map(map.features.map((item) => [item.id, item]));
  const out = [`## ${t('md.matrix.roleFeature.heading')}`, '', t('md.matrix.roleFeature.note'), ''];
  if (roles.length === 0 || features.length === 0) return [...out, t('md.none'), ''];
  const cellOf = (role, id) => (cells.find((cell) => cell.role === role && cell.feature === id)?.can ?? []).map(inline).join('<br>');
  out.push(table([t('md.table.role'), ...features.map((id) => featureText(feature.get(id), t))], roles.map((role) => [role, ...features.map((id) => cellOf(role, id))])), '');
  return out;
}

function applicationsSection({ map, entities, summary, system, t }) {
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

function systemsSection({ entities, t }) {
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

function applicationDomainMatrix({ entities, t }) {
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

/** The entity sections of a view, as lines: between the cross-cutting tables and the coverage section. */
export function entitySections({ view, map, entities, summary, system, t }) {
  const input = { map, entities, summary, system, t };
  const out = [...domainsSection(input), ...rolesSection(input), ...roleFeatureMatrix(input)];
  if (view === 'technical') out.push(...applicationsSection(input), ...systemsSection(input), ...applicationDomainMatrix(input));
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
