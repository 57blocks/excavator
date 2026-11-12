/**
 * The claim of each item of an entry (design D14): all the reader-visible
 * text of the item with the context a reader needs to understand it, so a
 * verifier that sees nothing else can judge it. A field rule carries its
 * screen, field and side; a sentence its operation's name; a notification
 * its four parts; `who` its role. The connecting words are the fixed texts of
 * the run's table (`ui`), so the claim is in the run's language like the
 * entry. Keys are the item paths of items.mjs.
 */

import { OPERATION_PARTS, partList, transitionList } from './entry-parts.mjs';
import { fill } from './ui.mjs';

const SEP = ' > ';

/** A Map from item path to claim for every item of `entry` that carries evidence. */
export function itemClaims(entry, ui, { map = null } = {}) {
  // A handoff's claim names the feature it hands to, so the verifiers judge the link too; without the map, its id stands in.
  const featureName = (id) => map?.features.find((feature) => feature.id === id)?.name ?? id;
  const t = (key) => {
    if (!Object.hasOwn(ui, key)) throw new Error(`the fixed-text table has no key ${key}`);
    return ui[key];
  };
  const claims = new Map();
  if (entry.purpose !== undefined) claims.set('purpose', [t('md.section.purpose'), entry.purpose.text].join(SEP));
  entry.who.forEach((who, i) => claims.set(`who[${i}]`, [t('md.section.who'), fill(t('md.who.item'), { role: who.role, can: who.can })].join(SEP)));
  entry.where.forEach((place, i) => claims.set(`where[${i}]`, [t('md.section.where'), place.label].join(SEP)));
  entry.screens.forEach((screen, i) => {
    const screenText = fill(t('md.screen.heading'), { name: screen.name });
    claims.set(`screens[${i}]`, screenText);
    (screen.fields ?? []).forEach((field, j) => {
      const fieldText = `${t('md.table.field')}: ${field.label}`;
      claims.set(`screens[${i}].fields[${j}]`, [screenText, fieldText].join(SEP));
      field.rules.forEach((rule, k) => {
        const side = t(rule.side === 'frontend' ? 'md.table.frontendRules' : 'md.table.backendRules');
        claims.set(`screens[${i}].fields[${j}].rules[${k}]`, [screenText, fieldText, side, rule.text].join(SEP));
      });
    });
  });
  (entry.operations ?? []).forEach((operation, i) => {
    operation.sentences.forEach((sentence, j) => {
      claims.set(`operations[${i}].sentences[${j}]`, [t('md.section.operations'), operation.name, sentence.text].join(SEP));
    });
    // A new part's claim carries the section, the operation and the part, like a step carries the section and the operation.
    for (const part of OPERATION_PARTS) {
      partList(operation, part).forEach((element, k) => {
        let body = element.text;
        if (part.key === 'handoffs') body = fill(t(part.itemUiKey), { feature: featureName(element.feature), text: element.text });
        else if (part.itemUiKey !== undefined) body = fill(t(part.itemUiKey), { when: element.when, then: element.then });
        claims.set(`operations[${i}].${part.key}[${k}]`, [t('md.section.operations'), operation.name, t(part.uiKey), body].join(SEP));
      });
    }
  });
  // The hand-overs of a /3 fact sheet are at the top level (a /2 entry keeps them in its operations).
  (entry.handoffs ?? []).forEach((handoff, i) => {
    claims.set(`handoffs[${i}]`, [t('md.operation.handoffs'), fill(t('md.handoff.item'), { feature: featureName(handoff.feature), text: handoff.text })].join(SEP));
  });
  entry.states.forEach((state, i) => {
    claims.set(`states[${i}]`, `${t('md.table.state')}: ${state.label}; ${t('md.table.meaning')}: ${state.meaning}`);
  });
  transitionList(entry).forEach((transition, i) => {
    claims.set(`transitions[${i}]`, [t('md.section.transitions'), fill(t('md.transition.item'), { from: transition.from, to: transition.to, by: transition.by })].join(SEP));
  });
  entry.notifications.forEach((n, i) => {
    claims.set(`notifications[${i}]`, [['md.table.trigger', 'trigger'], ['md.table.recipient', 'recipient'], ['md.table.channel', 'channel'], ['md.table.content', 'content']]
      .map(([key, field]) => `${t(key)}: ${n[field]}`).join('; '));
  });
  entry.automatic.forEach((a, i) => claims.set(`automatic[${i}]`, [t('md.section.automatic'), fill(t('md.automatic.item'), { when: a.when, effect: a.effect })].join(SEP)));
  return claims;
}
