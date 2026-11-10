import type { ReactNode } from 'react';

import { useFeatureDetail } from '../lib/chunks';
import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import { findingCategoryKey } from '../lib/types';
import type { Area, Entry, Feature, Field, FindingGroup, Operation, Rule, UnitLocations } from '../lib/types';
import { ChunkNotice } from './ChunkNotice';
import { Locations } from './Locations';
import { PriorityBadge } from './PriorityBadge';
import { ReachBadge } from './ReachBadge';
import { SequenceDiagram } from './SequenceDiagram';
import { Definition, DefinitionList, Item, ItemField, ItemList } from './ui/ItemList';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="section" aria-labelledby={`sec-${id}`}>
      <h2 className="section-title" id={`sec-${id}`}>{title}</h2>
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
      <h4 className="part-label">{label}</h4>
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
      <h3 className="operation-title">{operation.name}</h3>
      <OperationPart part="triggers" label={t('md.operation.triggers')} items={operation.triggers} />
      <div className="operation-part" data-part="steps">
        <h4 className="part-label">{t('md.operation.steps')}</h4>
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
              <h3 className="screen-title">{heading}</h3>
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
            <h3 className="part-label">{t('md.section.transitions')}</h3>
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

/** One feature (`featureNames`: the name of each feature by id, for the features an operation hands over to): its domain (and, when the page groups by business domain, the area of the navigation it sits in), how readers get to it, and the checked entry, or why there is none, then its verified findings; in the technical view, the file and lines of each cited item. */
export function FeaturePage({ feature, findings, domain, area, locations, featureNames = new Map() }: { feature: Feature; findings: FindingGroup[]; domain: Area | undefined; area: Area | undefined; locations?: UnitLocations; featureNames?: Map<string, string> }) {
  const t = useText();
  const nav = useLinks();
  const detail = useFeatureDetail(feature, locations);
  return (
    <article className="page" data-view="feature" data-feature={feature.id}>
      <nav className="crumbs" aria-label={t('page.breadcrumb.label')}>
        <ol>
          <li><a href={nav.overview}>{t('page.nav.overview')}</a></li>
          {domain !== undefined && <li><a href={nav.domain(domain.id)}>{domain.name}</a></li>}
          <li aria-current="page">{feature.name}</li>
        </ol>
      </nav>
      <header className="page-head">
        <h1 className="page-title">{feature.name}</h1>
        <div className="feature-facts">
          <ReachBadge reach={feature.reach} />
          {feature.label !== undefined && <span className="shown-as">{t('md.feature.label', { label: feature.label })}</span>}
          {area !== undefined && <span className="shown-as">{t('md.feature.area', { area: area.name })}</span>}
        </div>
      </header>
      {detail.status !== 'ready' ? <ChunkNotice state={detail} /> : detail.value.entry === null ? (
        <div className="notice" role="note">
          <p>{t('page.feature.noEntry')}</p>
          <p className="status-chip" data-status={feature.status}>{t(`md.status.${feature.status}`)}</p>
        </div>
      ) : <EntryBody entry={detail.value.entry} featureNames={featureNames} />}
      <FindingsSection feature={feature} groups={findings} />
      {detail.status === 'ready' && detail.value.entry !== null && detail.value.locations !== undefined && <Locations unit={detail.value.locations} />}
    </article>
  );
}
