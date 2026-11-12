/**
 * The parts of a feature entry that a /2 entry and a /3 fact sheet (openspec change handbook-free-chapter) both have, as the lines
 * of handbook.md: who, where, states with their transitions, notifications, automatic behaviour and what is undetermined. Each
 * function returns the lines of its section, heading first.
 */

import { transitionList } from './entry-parts.mjs';
import { stateGraph, stateMermaid } from './flows.mjs';
import { inline, table } from './markdown.mjs';
import { fill } from './ui.mjs';

export function whoLines(entry, t) {
  const out = [`#### ${t('md.section.who')}`, ''];
  if (entry.who.length === 0) out.push(t('md.none'), '');
  else out.push(...entry.who.map((who) => `- ${inline(fill(t('md.who.item'), { role: who.role, can: who.can }))}`), '');
  return out;
}

export function whereLines(entry, t) {
  return [`#### ${t('md.section.where')}`, '', entry.where.length === 0 ? t('md.none') : entry.where.map((place) => inline(place.label)).join(' > '), ''];
}

export function statesLines(entry, t) {
  const out = [`#### ${t('md.section.states')}`, ''];
  out.push(entry.states.length === 0
    ? t('md.none')
    : table([t('md.table.state'), t('md.table.meaning')], entry.states.map((state) => [state.label, state.meaning])), '');
  const transitions = transitionList(entry);
  if (transitions.length > 0) {
    out.push(`**${t('md.section.transitions')}**`, '');
    out.push(...transitions.map((x) => `- ${inline(fill(t('md.transition.item'), { from: x.from, to: x.to, by: x.by }))}`), '');
    out.push(...stateMermaid(stateGraph(entry)), '');
  }
  return out;
}

export function notificationsLines(entry, t) {
  const out = [`#### ${t('md.section.notifications')}`, ''];
  out.push(entry.notifications.length === 0
    ? t('md.none')
    : table(
      [t('md.table.trigger'), t('md.table.recipient'), t('md.table.channel'), t('md.table.content')],
      entry.notifications.map((n) => [n.trigger, n.recipient, n.channel, n.content]),
    ), '');
  return out;
}

export function automaticLines(entry, t) {
  const out = [`#### ${t('md.section.automatic')}`, ''];
  if (entry.automatic.length === 0) out.push(t('md.none'), '');
  else out.push(...entry.automatic.map((a) => `- ${inline(fill(t('md.automatic.item'), { when: a.when, effect: a.effect }))}`), '');
  return out;
}

export function unknownsLines(entry, t) {
  const out = [`#### ${t('md.section.unknowns')}`, ''];
  if (entry.unknowns.length === 0) out.push(t('md.none'), '');
  else out.push(...entry.unknowns.map((u) => `- ${inline(fill(t('md.unknown.item'), { item: u.item, searched: u.searched }))}`), '');
  return out;
}
