/**
 * The Appendix blocks of handbook.md (openspec change handbook-history-appendix,
 * design D3 and D4), written from the model of appendix.mjs: the open questions,
 * the glossary, and the sources and scope. Every fixed text is a ui key; every
 * other word is a verified entry's or a count of the run. Nothing is written that
 * a verified entry does not hold. Pure and deterministic.
 */

import { inline, table } from './markdown.mjs';
import { fill } from './ui.mjs';

const DASH = '-';
const camel = (text) => text.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** The ui key of the name of a section of the sources part (`system-findings` is `systemFindings`). */
export const sectionKey = (id) => `md.appendix.section.${camel(id)}`;

function openBlock(appendix, names, domains, t) {
  const out = [`### ${t('md.appendix.openHeading')}`, '', t('md.appendix.openNote'), '', fill(t('md.appendix.openCount'), { count: appendix.open.length }), ''];
  if (appendix.open.length === 0) return [...out, t('md.none'), ''];
  const headers = [t('md.table.feature'), t('md.appendix.table.question'), t('md.appendix.table.searched')];
  const groups = [{ id: null, name: t('md.overview.heading') }, ...domains];
  for (const group of groups) {
    const rows = appendix.open.filter((row) => row.domain === group.id).map((row) => [row.feature === null ? DASH : names.get(row.feature) ?? row.feature, row.item, row.searched]);
    if (rows.length > 0) out.push(`#### ${inline(group.name)}`, '', table(headers, rows), '');
  }
  return out;
}

function glossaryBlock(appendix, names, t) {
  const out = [`### ${t('md.appendix.glossaryHeading')}`, '', t('md.appendix.glossaryNote'), '', fill(t('md.appendix.glossaryCount'), { count: appendix.glossary.length }), ''];
  if (appendix.glossary.length === 0) return [...out, t('md.none'), ''];
  const featureList = (ids) => ids.map((id) => inline(names.get(id) ?? id)).join(', ');
  const rows = appendix.glossary.map((row) => [
    row.term,
    row.kinds.map((kind) => t(`md.appendix.kind.${kind}`)).join(', '),
    row.meanings.length === 0 ? DASH : row.meanings.map((meaning) => inline(fill(t('md.appendix.meaningItem'), { meaning: meaning.text, features: featureList(meaning.features) }))).join('<br>'),
    featureList(row.features),
  ]);
  out.push(table([t('md.appendix.table.term'), t('md.appendix.table.kind'), t('md.table.meaning'), t('md.table.features')], rows), '');
  return out;
}

function sourcesBlock({ sources }, t) {
  const out = [`### ${t('md.appendix.sourcesHeading')}`, '', t('md.appendix.read'), '', t('md.appendix.notRead'), '', t('md.appendix.checks'), '', t('md.appendix.sectionsNote'), ''];
  out.push(table(
    [t('md.appendix.table.section'), t('md.appendix.table.units'), t('md.appendix.table.verifiedUnits'), t('md.appendix.table.items'), t('md.appendix.table.removedVerify'), t('md.appendix.table.removedTrace'), t('md.appendix.table.again')],
    sources.parts.map((row) => [t(sectionKey(row.id)), String(row.units), String(row.verified), String(row.items), String(row.removedVerify), String(row.removedTrace), String(row.again)]),
  ), '');
  out.push(t('md.appendix.rankedNote'), '');
  out.push(table(
    [t('md.appendix.table.part'), t('md.appendix.table.kept'), t('md.appendix.table.leftOut')],
    ['priority', 'remedies', 'topics'].map((id) => [t(`md.appendix.ranked.${id}`), String(sources.ranked[id].kept), String(sources.ranked[id].left)]),
  ), '');
  return out;
}

/**
 * The three blocks of the appendix, each a list of lines starting with its own heading: the open questions (after the
 * note that a script writes the appendix), the glossary, and the sources and scope. `entities.domains` give the groups
 * of the open questions (the overview's first) and `map` the names of the features.
 */
export function appendixBlocks({ appendix, map, entities, t }) {
  const names = new Map(map.features.map((feature) => [feature.id, feature.name]));
  const [heading, ...open] = openBlock(appendix, names, entities.domains, t);
  return {
    'open-questions': [heading, '', t('md.appendix.note'), ...open],
    glossary: glossaryBlock(appendix, names, t),
    sources: sourcesBlock(appendix, t),
  };
}
