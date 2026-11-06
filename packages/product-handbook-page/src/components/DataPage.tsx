import { useState } from 'react';

import { useText } from '../lib/text';
import type { Text } from '../lib/text';
import type { DataSection, DataTable, PageData, Technical } from '../lib/types';
import { Cell, TableScroll } from './Tables';

/** The bucket of the places that belong to no application. */
const NO_APPLICATION = '';

export type DataOrder = 'name' | 'applications';

/** The number of applications a table's name appears in; the places that belong to no application are not an application. */
const applicationCount = (table: DataTable): number => Object.entries(table.mentions).filter(([key, list]) => key !== NO_APPLICATION && list.length > 0).length;

/** The tables in the order asked for, as a new list: by name in byte order, or by the number of applications, most first, then by name. */
export function sortedTables(tables: DataTable[], order: DataOrder): DataTable[] {
  const byName = (a: DataTable, b: DataTable): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return [...tables].sort(order === 'name' ? byName : (a, b) => applicationCount(b) - applicationCount(a) || byName(a, b));
}

const place = (t: Text, file: string, line: number): string => t('md.locations.placeOne', { file, line });
const kindText = (t: Text, kind: string): string => t(`md.data.kind.${kind}`);
const formKey = (form: string): string => `md.data.form.${form.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`;
const applicationLabel = (t: Text, key: string): string => (key === NO_APPLICATION ? t('md.data.noApplication') : key);

function ApplicationsCell({ table, onlyInMigrations }: { table: DataTable; onlyInMigrations: boolean }) {
  const t = useText();
  const keys = Object.keys(table.mentions);
  if (keys.length === 0) return <td>{onlyInMigrations ? t('md.data.onlyInMigrationsCell') : undefined}</td>;
  const total = keys.reduce((sum, key) => sum + table.mentions[key].length, 0);
  return (
    <td>
      <ul className="rule-list">
        {keys.map((key) => <li key={key}>{t('md.data.mentionCount', { application: applicationLabel(t, key), count: table.mentions[key].length })}</li>)}
      </ul>
      <details className="data-mentions">
        <summary>{t('page.data.mentions', { count: total })}</summary>
        {keys.map((key) => (
          <div key={key}>
            <p className="muted">{applicationLabel(t, key)}</p>
            <ul className="rule-list">
              {table.mentions[key].map((mention, at) => <li key={at}>{t('md.data.mentionPlace', { place: place(t, mention.file, mention.line), rule: t(`md.data.rule.${mention.rule}`) })}</li>)}
            </ul>
          </div>
        ))}
      </details>
    </td>
  );
}

function TablesTable({ section }: { section: DataSection }) {
  const t = useText();
  const [order, setOrder] = useState<DataOrder>('name');
  const only = new Set(section.onlyInMigrations);
  const heading = t('md.data.tablesHeading');
  const sort = (value: DataOrder, key: string) => <button type="button" className="data-sort" aria-pressed={order === value} onClick={() => setOrder(value)}>{t(key)}</button>;
  return (
    <>
      <h2 className="section-title">{heading}</h2>
      <div className="data-sorts" role="group" aria-label={t('page.data.sort.label')}>
        {sort('name', 'page.data.sort.name')}
        {sort('applications', 'page.data.sort.applications')}
      </div>
      {section.tables.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <TableScroll label={heading} wide>
          <thead>
            <tr>
              <th scope="col">{t('md.data.table.name')}</th>
              <th scope="col">{t('md.data.table.declared')}</th>
              <th scope="col">{t('md.data.table.applications')}</th>
              <th scope="col">{t('md.data.table.createdBy')}</th>
              <th scope="col">{t('md.data.table.lastChangedBy')}</th>
            </tr>
          </thead>
          <tbody data-part="data-tables">
            {sortedTables(section.tables, order).map((table) => (
              <tr key={table.name} data-table={table.name}>
                <Cell row>{table.name}</Cell>
                <Cell>
                  {table.sources.length === 0 ? undefined : (
                    <ul className="rule-list">
                      {table.sources.map((source, at) => <li key={at}>{t(source.as === undefined ? 'md.data.source' : 'md.data.sourceAs', { kind: kindText(t, source.kind), place: place(t, source.file, source.line), name: source.as ?? '' })}</li>)}
                    </ul>
                  )}
                </Cell>
                <ApplicationsCell table={table} onlyInMigrations={only.has(table.name)} />
                <Cell>{table.createdBy ?? undefined}</Cell>
                <Cell>{table.lastChangedBy ?? undefined}</Cell>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </>
  );
}

function List({ heading, items, level = 2 }: { heading: string; items: string[]; level?: 2 | 3 }) {
  const t = useText();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <>
      <Heading className="section-title">{heading}</Heading>
      {items.length === 0 ? <p className="muted">{t('md.none')}</p> : <ul className="rule-list">{items.map((item, at) => <li key={at}>{item}</li>)}</ul>}
    </>
  );
}

function SectionBody({ section }: { section: DataSection }) {
  const t = useText();
  const { counts, gaps } = section;
  return (
    <>
      <div className="summary-note" data-part="data-note">
        {['md.data.note.nameRules', 'md.data.note.comments', 'md.data.note.ormDefaults', 'md.data.note.onlyInMigrations'].map((key) => <p className="muted" key={key}>{t(key)}</p>)}
        <p className="muted">{t('md.data.recognized', { forms: section.recognized.map((form) => t(formKey(form))).join('; ') })}</p>
      </div>
      <p className="summary-counts">
        {t('md.data.counts', {
          tables: counts.tables,
          migrations: counts.migrations,
          replayed: counts.migrationsReplayed,
          unsplit: counts.migrationsUnsplit,
          downOnly: counts.migrationsDownOnly,
          several: counts.tablesInSeveralApplications,
          onlyInMigrations: counts.onlyInMigrations,
          dropped: counts.dropped,
          gaps: counts.gaps,
        })}
      </p>
      <h2 className="section-title">{t('md.data.migrationsHeading')}</h2>
      {section.applications.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <TableScroll label={t('md.data.migrationsHeading')}>
          <thead><tr><th scope="col">{t('md.table.application')}</th><th scope="col">{t('md.data.table.migrations')}</th></tr></thead>
          <tbody>
            {section.applications.map((row) => <tr key={row.directory}><Cell row>{applicationLabel(t, row.directory)}</Cell><td className="num">{row.migrations}</td></tr>)}
          </tbody>
        </TableScroll>
      )}
      <TablesTable section={section} />
      <h2 className="section-title">{t('md.data.droppedHeading')}</h2>
      {section.dropped.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <TableScroll label={t('md.data.droppedHeading')} wide>
          <thead>
            <tr><th scope="col">{t('md.data.table.name')}</th><th scope="col">{t('md.data.table.createdBy')}</th><th scope="col">{t('md.data.table.droppedBy')}</th></tr>
          </thead>
          <tbody>
            {section.dropped.map((row, at) => <tr key={at}><Cell row>{row.name}</Cell><Cell>{row.createdBy ?? undefined}</Cell><Cell>{place(t, row.file, row.line)}</Cell></tr>)}
          </tbody>
        </TableScroll>
      )}
      <List heading={t('md.data.declaredOnlyHeading')} items={section.declaredOnly} />
      <List heading={t('md.data.droppedButDeclaredHeading')} items={section.droppedButDeclared} />
      <List heading={t('md.data.changedNeverCreatedHeading')} items={section.changedNeverCreated} />
      <List heading={t('md.data.onlyInMigrationsHeading')} items={section.onlyInMigrations} />
      <h2 className="section-title">{t('md.data.gapsHeading')}</h2>
      <List level={3} heading={t('md.data.gap.unnamedHeading')} items={gaps.unnamedOperations.map((row) => t('md.data.gap.unnamed', { place: place(t, row.file, row.line), op: row.op }))} />
      <List level={3} heading={t('md.data.gap.unsplitHeading')} items={gaps.unsplitMigrations.map((row) => row.file)} />
      <List level={3} heading={t('md.data.gap.unresolvedHeading')} items={gaps.unresolvedModelNames.map((row) => t(row.matches === null ? 'md.data.gap.unresolved' : 'md.data.gap.unresolvedMatches', { place: place(t, row.file, row.line), expression: row.expression, matches: row.matches ?? 0 }))} />
      <List level={3} heading={t('md.data.gap.otherHeading')} items={gaps.otherMigrationFiles.map((row) => t('md.data.gap.other', { file: row.file, reason: t(`md.data.gap.reason.${row.reason}`) }))} />
    </>
  );
}

/** The technical view's data page: the tables the migrations and models give, the migrations of each application and where each table name appears; the same content as the handbook's data chapter. A section that was not written, or is malformed, is one line. */
export function DataPage({ data, technical }: { data: PageData; technical: Technical }) {
  const t = useText();
  const { data: section, dataState } = technical;
  return (
    <article className="page" data-view="data">
      <header className="page-head">
        <p className="eyebrow">{data.project}</p>
        <h1 className="page-title">{t('md.data.heading')}</h1>
      </header>
      {section === null
        ? <p className="muted" data-part="data-status">{t(dataState === 'malformed' ? 'md.data.malformed' : 'md.data.notWritten')}</p>
        : <SectionBody section={section} />}
    </article>
  );
}
