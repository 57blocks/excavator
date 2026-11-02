/**
 * handbook.md (design D11, D14), rendered from data already checked: the map, the
 * verified entries, the state, the candidates and the fixed-text table. Pure
 * and deterministic: the same input gives the same bytes, with no time, no
 * path and no citation in the text. Every fixed text comes from `ui`.
 */

import { REACHES } from './map-shape.mjs';
import { inline, table } from './markdown.mjs';
import { fill } from './ui.mjs';

const NONE_ROW = '-';

/** The reach counts, one per reach in a fixed order, zeros included. */
export function reachCounts(map) {
  return REACHES.map((reach) => ({ reach, count: map.features.filter((feature) => feature.reach === reach).length }));
}

function screensBlock(entry, t) {
  if (entry.screens.length === 0) return [t('md.none'), ''];
  const out = [];
  for (const screen of entry.screens) {
    out.push(`##### ${inline(fill(t('md.screen.heading'), { name: screen.name }))}`, '');
    if (screen.fields.length === 0) {
      out.push(t('md.none'), '');
      continue;
    }
    const rows = screen.fields.map((field) => {
      const side = (name) => field.rules.filter((rule) => rule.side === name).map((rule) => inline(rule.text)).join('<br>') || NONE_ROW;
      return [field.label, side('frontend'), side('backend')];
    });
    out.push(table([t('md.table.field'), t('md.table.frontendRules'), t('md.table.backendRules')], rows), '');
  }
  return out;
}

function entryBlock(feature, entry, map, t) {
  const reachText = t(`md.reach.${feature.reach}`);
  const out = [`### ${inline(feature.name)}`, '', inline(fill(t('md.feature.reach'), { reach: reachText })), ''];
  if (feature.label !== undefined) out.push(inline(fill(t('md.feature.label'), { label: feature.label })), '');
  if (entry.purpose !== undefined) out.push(`#### ${t('md.section.purpose')}`, '', inline(entry.purpose.text), '');
  out.push(`#### ${t('md.section.who')}`, '');
  if (entry.who.length === 0) out.push(t('md.none'), '');
  else out.push(...entry.who.map((who) => `- ${inline(fill(t('md.who.item'), { role: who.role, can: who.can }))}`), '');
  out.push(`#### ${t('md.section.where')}`, '');
  out.push(entry.where.length === 0 ? t('md.none') : entry.where.map((place) => inline(place.label)).join(' > '), '');
  out.push(`#### ${t('md.section.screens')}`, '', ...screensBlock(entry, t));
  out.push(`#### ${t('md.section.operations')}`, '');
  if (entry.operations.length === 0) out.push(t('md.none'), '');
  for (const operation of entry.operations) {
    out.push(`##### ${inline(operation.name)}`, '', operation.sentences.map((sentence) => inline(sentence.text)).join(' '), '');
  }
  out.push(`#### ${t('md.section.states')}`, '');
  out.push(entry.states.length === 0
    ? t('md.none')
    : table([t('md.table.state'), t('md.table.meaning')], entry.states.map((state) => [state.label, state.meaning])), '');
  out.push(`#### ${t('md.section.notifications')}`, '');
  out.push(entry.notifications.length === 0
    ? t('md.none')
    : table(
      [t('md.table.trigger'), t('md.table.recipient'), t('md.table.channel'), t('md.table.content')],
      entry.notifications.map((n) => [n.trigger, n.recipient, n.channel, n.content]),
    ), '');
  out.push(`#### ${t('md.section.automatic')}`, '');
  if (entry.automatic.length === 0) out.push(t('md.none'), '');
  else out.push(...entry.automatic.map((a) => `- ${inline(fill(t('md.automatic.item'), { when: a.when, effect: a.effect }))}`), '');
  out.push(`#### ${t('md.section.unknowns')}`, '');
  if (entry.unknowns.length === 0) out.push(t('md.none'), '');
  else out.push(...entry.unknowns.map((u) => `- ${inline(fill(t('md.unknown.item'), { item: u.item, searched: u.searched }))}`), '');
  return out;
}

function coverageBlock(map, state, candidates, t) {
  const areaName = new Map(map.areas.map((area) => [area.id, area.name]));
  const featureText = (key, feature) => `- ${inline(fill(t(key), { id: feature.id, name: feature.name, area: areaName.get(feature.area) }))}`;
  const claimed = map.features.reduce((sum, feature) => sum + feature.candidates.length, 0);
  const out = [`## ${t('md.coverage.heading')}`, ''];
  out.push(fill(t('md.coverage.conserved'), { total: candidates.length, assigned: claimed, unassigned: map.unassigned.length }), '');

  out.push(`### ${t('md.coverage.reachHeading')}`, '');
  out.push(table([t('md.table.reach'), t('md.table.features')], reachCounts(map).map(({ reach, count }) => [t(`md.reach.${reach}`), String(count)])), '');

  out.push(`### ${t('md.coverage.linkHeading')}`, '');
  const links = map.features.filter((feature) => feature.reach === 'link');
  out.push(...(links.length === 0 ? [t('md.none')] : links.map((feature) => featureText('md.coverage.linkItem', feature))), '');

  out.push(`### ${t('md.coverage.unassignedHeading')}`, '');
  if (map.unassigned.length === 0) {
    out.push(t('md.none'), '');
  } else {
    const kind = new Map(candidates.map((candidate) => [candidate.id, candidate.kind]));
    out.push(table(
      [t('md.table.candidate'), t('md.table.kind'), t('md.table.reason')],
      map.unassigned.map((entry) => [entry.candidate, t(`md.kind.${kind.get(entry.candidate)}`), entry.reason]),
    ), '');
  }

  out.push(`### ${t('md.coverage.unwrittenHeading')}`, '');
  const unwritten = map.features.filter((feature) => state.features[feature.id].status !== 'verified');
  if (unwritten.length === 0) {
    out.push(t('md.coverage.allWritten'));
  } else {
    out.push(table(
      [t('md.table.feature'), t('md.table.status')],
      unwritten.map((feature) => [
        fill(t('md.coverage.unwrittenItem'), { id: feature.id, name: feature.name, area: areaName.get(feature.area) }),
        t(`md.status.${state.features[feature.id].status}`),
      ]),
    ));
  }
  out.push('');

  out.push(`### ${t('md.coverage.removedHeading')}`, '');
  const withRemoved = map.features.filter((feature) => (state.features[feature.id].removed ?? []).length > 0);
  if (withRemoved.length === 0) out.push(t('md.none'), '');
  for (const feature of withRemoved) {
    const removed = state.features[feature.id].removed;
    out.push(`#### ${inline(fill(t('md.coverage.removedFeature'), { id: feature.id, name: feature.name, area: areaName.get(feature.area), count: removed.length }))}`, '');
    out.push(table(
      [t('md.table.item'), t('md.table.result'), t('md.table.reason')],
      removed.map((item) => [item.claim, t(`md.verdict.${item.verdict}`), item.reason === '' ? NONE_ROW : item.reason]),
    ), '');
  }
  return out;
}

/**
 * The handbook text. `entries` maps the id of each verified feature to its
 * entry (only verified features have one); `candidates` is candidates.json's items; `ui` is the strings table.
 */
export function renderHandbook({ map, entries, state, candidates, ui }) {
  const t = (key) => {
    if (!Object.hasOwn(ui, key)) throw new Error(`the fixed-text table has no key ${key}`);
    return ui[key];
  };
  const out = [`# ${inline(t('md.title'))}`, '', `## ${t('md.areas.heading')}`, ''];
  for (const area of map.areas) {
    out.push(`- **${inline(area.name)}**`);
    const features = map.features.filter((feature) => feature.area === area.id);
    if (features.length === 0) out.push(`  - ${t('md.areas.noFeatures')}`);
    for (const feature of features) {
      out.push(`  - ${inline(fill(t('md.areas.featureLine'), { name: feature.name, reach: t(`md.reach.${feature.reach}`) }))}`);
    }
  }
  out.push('', table([t('md.table.reach'), t('md.table.features')], reachCounts(map).map(({ reach, count }) => [t(`md.reach.${reach}`), String(count)])), '');
  for (const area of map.areas) {
    const written = map.features.filter((feature) => feature.area === area.id && entries.has(feature.id));
    if (written.length === 0) continue;
    out.push(`## ${inline(area.name)}`, '');
    for (const feature of written) out.push(...entryBlock(feature, entries.get(feature.id), map, t));
  }
  out.push(...coverageBlock(map, state, candidates, t));
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

