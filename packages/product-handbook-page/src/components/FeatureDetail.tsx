import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';

import { useFeatureDetail } from '../lib/chunks';
import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import { findingCategoryKey } from '../lib/types';
import type { Entry, Feature, Field, FindingGroup, Operation, Rule, UnitLocations } from '../lib/types';
import { ChunkNotice } from './ChunkNotice';
import { Locations } from './Locations';
import { PriorityBadge } from './PriorityBadge';
import { SequenceDiagram } from './SequenceDiagram';
import { Definition, DefinitionList, Item, ItemField, ItemList } from './ui/ItemList';

/**
 * Where the detail of a feature is shown (openspec change handbook-outline, D7): on its own page its sections are second-level
 * headings; on a domain page the detail sits one level lower, under the feature's name, and each element id is prefixed with
 * the feature's so that several details on one page keep unique ids. `offset` moves every heading level down.
 */
export interface FeatureScope { offset: number; prefix: string }
const PAGE_SCOPE: FeatureScope = { offset: 0, prefix: '' };
const ScopeContext = createContext<FeatureScope>(PAGE_SCOPE);
export const FeatureScopeProvider = ScopeContext.Provider;

/** A heading `level` levels deep in the page's own numbering (2 is a section), moved down by the scope and never deeper than six. */
function Heading({ level, ...rest }: { level: number; className: string; id?: string; children: ReactNode }) {
  const { offset } = useContext(ScopeContext);
  return createElement(`h${Math.min(6, level + offset)}`, rest);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const { prefix } = useContext(ScopeContext);
  return (
    <section className="section" aria-labelledby={`sec-${prefix}${id}`}>
      <Heading level={2} className="section-title" id={`sec-${prefix}${id}`}>{title}</Heading>
      {children}
    </section>
  );
}

/** The rules of one side of a field: nothing (an empty cell) for none, plain text for one, a list for several. */
function rulesOf(field: Field, side: Rule['side']): ReactNode {
  const texts = field.rules.filter((rule) => rule.side === side).map((rule) => rule.text);
  if (texts.length === 0) return null;
  return texts.length === 1 ? texts[0] : <ul className="rule-list">{texts.map((text, at) => <li key={at}>{text}</li>)}</ul>;
}

/** One part of an operation: a label and a list; nothing when the part has no element. */
function OperationPart({ part, label, items }: { part: string; label: string; items: ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <div className="operation-part" data-part={part}>
      <Heading level={4} className="part-label">{label}</Heading>
      <ul className="plain-list">{items.map((item, at) => <li key={at}>{item}</li>)}</ul>
    </div>
  );
}

/**
 * One operation (openspec change handbook-deep-entry): what starts it, its steps numbered with the participant of each,
 * the sequence diagram the script computed, its fixed note, then its calculations, data changes, edge cases and the
 * features it hands over to, each a link to that feature's page before what passes to it (no separator, which would be
 * a fixed text the code wrote).
 */
function OperationBlock({ operation, featureNames }: { operation: Operation; featureNames: Map<string, string> }) {
  const t = useText();
  const nav = useLinks();
  const { participants, steps } = operation.sequence;
  return (
    <div className="operation" data-part="operation">
      <Heading level={3} className="operation-title">{operation.name}</Heading>
      <OperationPart part="triggers" label={t('md.operation.triggers')} items={operation.triggers} />
      <div className="operation-part" data-part="steps">
        <Heading level={4} className="part-label">{t('md.operation.steps')}</Heading>
        <ol className="step-list">
          {operation.sentences.map((sentence, at) => (
            <li key={at}>
              <span className="step-text">{sentence}</span>
              {steps[at] !== undefined && <span className="participant-chip">{participants[steps[at].to]}</span>}
            </li>
          ))}
        </ol>
      </div>
      {steps.length > 0 && (
        <>
          <SequenceDiagram sequence={operation.sequence} label={t('page.flow.label', { name: operation.name })} />
          <p className="muted flow-note">{t('md.flow.note')}</p>
        </>
      )}
      <OperationPart part="calculations" label={t('md.operation.calculations')} items={operation.calculations} />
      <OperationPart part="changes" label={t('md.operation.changes')} items={operation.changes} />
      <OperationPart part="edges" label={t('md.operation.edges')} items={operation.edges.map((edge) => t('md.edge.item', { when: edge.when, then: edge.then }))} />
      <OperationPart
        part="handoffs"
        label={t('md.operation.handoffs')}
        items={operation.handoffs.map((handoff) => (
          <><a className="handoff-link" href={nav.feature(handoff.feature)}>{featureNames.get(handoff.feature) ?? handoff.feature}</a> <span>{handoff.text}</span></>
        ))}
      />
    </div>
  );
}

function EntryBody({ entry, featureNames }: { entry: Entry; featureNames: Map<string, string> }) {
  const t = useText();
  const none = <p className="muted">{t('md.none')}</p>;
  return (
    <>
      {entry.purpose !== undefined && (
        <Section id="purpose" title={t('md.section.purpose')}>
          <p className="purpose">{entry.purpose}</p>
        </Section>
      )}

      <Section id="who" title={t('md.section.who')}>
        {entry.who.length === 0 ? none : (
          <ul className="who-list">
            {entry.who.map((who, at) => (
              <li key={at}>
                <span className="role">{who.role}</span>
                <span className="can">{who.can}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="where" title={t('md.section.where')}>
        {entry.where.length === 0 ? none : (
          <ol className="trail">
            {entry.where.map((place, at) => <li key={at}>{place}</li>)}
          </ol>
        )}
      </Section>

      <Section id="screens" title={t('md.section.screens')}>
        {entry.screens.length === 0 ? none : entry.screens.map((screen, at) => {
          const heading = t('md.screen.heading', { name: screen.name });
          return (
            <div className="screen" key={at}>
              <Heading level={3} className="screen-title">{heading}</Heading>
              {screen.fields.length === 0 ? none : (
                <>
                  {screen.fields.some((field) => field.rules.length > 0) && (
                    <ItemList part="fields" label={heading}>
                      {screen.fields.filter((field) => field.rules.length > 0).map((field, index) => {
                        const frontend = rulesOf(field, 'frontend');
                        const backend = rulesOf(field, 'backend');
                        return (
                          <Item key={index} attrs={field.label}>
                            {frontend !== null && <ItemField label={t('md.table.frontendRules')}>{frontend}</ItemField>}
                            {backend !== null && <ItemField label={t('md.table.backendRules')}>{backend}</ItemField>}
                          </Item>
                        );
                      })}
                    </ItemList>
                  )}
                  {screen.fields.some((field) => field.rules.length === 0) && (
                    <p className="fields-without-rules" data-part="fields-without-rules">
                      <span className="inline-label">{t('page.feature.fieldsWithoutRules')}</span> {screen.fields.filter((field) => field.rules.length === 0).map((field) => field.label).join(' \u00b7 ')}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </Section>

      <Section id="operations" title={t('md.section.operations')}>
        {entry.operations.length === 0 ? none : entry.operations.map((operation, at) => <OperationBlock key={at} operation={operation} featureNames={featureNames} />)}
      </Section>

      <Section id="states" title={t('md.section.states')}>
        {entry.states.length === 0 ? none : (
          <DefinitionList part="states" label={t('md.section.states')}>
            {entry.states.map((state, at) => <Definition key={at} term={state.label}>{state.meaning}</Definition>)}
          </DefinitionList>
        )}
        {entry.transitions.length > 0 && (
          <div className="operation-part" data-part="transitions">
            <Heading level={3} className="part-label">{t('md.section.transitions')}</Heading>
            <ul className="plain-list">
              {entry.transitions.map((x, at) => <li key={at}>{t('md.transition.item', { from: x.from, to: x.to, by: x.by })}</li>)}
            </ul>
          </div>
        )}
      </Section>

      <Section id="notifications" title={t('md.section.notifications')}>
        {entry.notifications.length === 0 ? none : (
          <ItemList part="notifications" label={t('md.section.notifications')}>
            {entry.notifications.map((n, at) => (
              <Item key={at} attrs={<span className="channel-chip">{n.channel}</span>}>
                <ItemField label={t('md.table.trigger')}>{n.trigger}</ItemField>
                <ItemField label={t('md.table.recipient')}>{n.recipient}</ItemField>
                <ItemField label={t('md.table.content')}>{n.content}</ItemField>
              </Item>
            ))}
          </ItemList>
        )}
      </Section>

      <Section id="automatic" title={t('md.section.automatic')}>
        {entry.automatic.length === 0 ? none : (
          <ul className="plain-list">
            {entry.automatic.map((item, at) => <li key={at}>{t('md.automatic.item', { when: item.when, effect: item.effect })}</li>)}
          </ul>
        )}
      </Section>

      <Section id="unknowns" title={t('md.section.unknowns')}>
        {entry.unknowns.length === 0 ? none : (
          <ul className="plain-list">
            {entry.unknowns.map((item, at) => <li key={at}>{t('md.unknown.item', { item: item.item, searched: item.searched })}</li>)}
          </ul>
        )}
      </Section>
    </>
  );
}

/** The feature's own verified findings with their category, from the groups that contain the feature (a group merged with another owner's finding still lists this feature's own statement); nothing when its findings are not verified (the coverage page says where they stopped). */
function FindingsSection({ feature, groups }: { feature: Feature; groups: FindingGroup[] }) {
  const t = useText();
  if (feature.findingsStatus !== 'verified') return null;
  const own = groups.flatMap((group) => group.items.filter((item) => item.owner.kind === 'feature' && item.owner.id === feature.id).map((item) => ({ item, category: group.category, priority: group.priority })));
  return (
    <Section id="findings" title={t('md.findings.heading')}>
      {own.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <ul className="plain-list">
          {own.map(({ item, category, priority }) => <li key={item.id}><PriorityBadge priority={priority} /> {t('md.findings.featureItem', { category: t(findingCategoryKey(category)), text: item.text })}</li>)}
        </ul>
      )}
    </Section>
  );
}


/**
 * The detail of one feature, the same on its page and on its domain's page: the checked entry (or why there is none, or the
 * chunk notice while its part loads or when a part file is missing), its verified findings and, in the technical view, the
 * file and lines of each cited item.
 */
export function FeatureDetail({ feature, findings, locations, featureNames }: { feature: Feature; findings: FindingGroup[]; locations?: UnitLocations; featureNames: Map<string, string> }) {
  const t = useText();
  const { prefix, offset } = useContext(ScopeContext);
  const detail = useFeatureDetail(feature, locations);
  return (
    <>
      {detail.status !== 'ready' ? <ChunkNotice state={detail} /> : detail.value.entry === null ? (
        <div className="notice" role="note">
          <p>{t('page.feature.noEntry')}</p>
          <p className="status-chip" data-status={feature.status}>{t(`md.status.${feature.status}`)}</p>
        </div>
      ) : <EntryBody entry={detail.value.entry} featureNames={featureNames} />}
      <FindingsSection feature={feature} groups={findings} />
      {detail.status === 'ready' && detail.value.entry !== null && detail.value.locations !== undefined && <Locations unit={detail.value.locations} id={`${prefix}locations`} level={2 + offset} />}
    </>
  );
}
