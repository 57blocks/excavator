import type { ReactNode } from 'react';

import { OVERVIEW_HASH } from '../lib/route';
import { useText } from '../lib/text';
import type { Area, Entry, Feature, Field, Rule } from '../lib/types';
import { ReachBadge } from './ReachBadge';
import { Cell, TableScroll } from './Tables';

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

function EntryBody({ entry }: { entry: Entry }) {
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
                <TableScroll label={heading} wide>
                  <thead>
                    <tr>
                      <th scope="col">{t('md.table.field')}</th>
                      <th scope="col">{t('md.table.frontendRules')}</th>
                      <th scope="col">{t('md.table.backendRules')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {screen.fields.map((field, index) => (
                      <tr key={index}>
                        <Cell row>{field.label}</Cell>
                        <Cell>{rulesOf(field, 'frontend')}</Cell>
                        <Cell>{rulesOf(field, 'backend')}</Cell>
                      </tr>
                    ))}
                  </tbody>
                </TableScroll>
              )}
            </div>
          );
        })}
      </Section>

      <Section id="operations" title={t('md.section.operations')}>
        {entry.operations.length === 0 ? none : entry.operations.map((operation, at) => (
          <div className="operation" key={at}>
            <h3 className="operation-title">{operation.name}</h3>
            <p>{operation.sentences.join(' ')}</p>
          </div>
        ))}
      </Section>

      <Section id="states" title={t('md.section.states')}>
        {entry.states.length === 0 ? none : (
          <TableScroll label={t('md.section.states')}>
            <thead>
              <tr><th scope="col">{t('md.table.state')}</th><th scope="col">{t('md.table.meaning')}</th></tr>
            </thead>
            <tbody>
              {entry.states.map((state, at) => (
                <tr key={at}><Cell row>{state.label}</Cell><Cell>{state.meaning}</Cell></tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </Section>

      <Section id="notifications" title={t('md.section.notifications')}>
        {entry.notifications.length === 0 ? none : (
          <TableScroll label={t('md.section.notifications')} wide>
            <thead>
              <tr>
                <th scope="col">{t('md.table.trigger')}</th>
                <th scope="col">{t('md.table.recipient')}</th>
                <th scope="col">{t('md.table.channel')}</th>
                <th scope="col">{t('md.table.content')}</th>
              </tr>
            </thead>
            <tbody>
              {entry.notifications.map((n, at) => (
                <tr key={at}><Cell>{n.trigger}</Cell><Cell>{n.recipient}</Cell><Cell>{n.channel}</Cell><Cell>{n.content}</Cell></tr>
              ))}
            </tbody>
          </TableScroll>
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

/** One feature: where it sits, how readers get to it, and the checked entry, or why there is none. */
export function FeaturePage({ feature, area }: { feature: Feature; area: Area | undefined }) {
  const t = useText();
  return (
    <article className="page" data-view="feature" data-feature={feature.id}>
      <nav className="crumbs" aria-label={t('page.breadcrumb.label')}>
        <ol>
          <li><a href={OVERVIEW_HASH}>{t('page.nav.overview')}</a></li>
          {area !== undefined && <li>{area.name}</li>}
          <li aria-current="page">{feature.name}</li>
        </ol>
      </nav>
      <header className="page-head">
        <h1 className="page-title">{feature.name}</h1>
        <div className="feature-facts">
          <ReachBadge reach={feature.reach} />
          {feature.label !== undefined && <span className="shown-as">{t('md.feature.label', { label: feature.label })}</span>}
        </div>
      </header>
      {feature.entry === null ? (
        <div className="notice" role="note">
          <p>{t('page.feature.noEntry')}</p>
          <p className="status-chip" data-status={feature.status}>{t(`md.status.${feature.status}`)}</p>
        </div>
      ) : <EntryBody entry={feature.entry} />}
    </article>
  );
}
