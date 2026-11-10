import { useState } from 'react';

import { useDictionaries } from '../lib/chunks';
import { systemName, useText } from '../lib/text';
import type { Text } from '../lib/text';
import type { DictionariesSection, DictionaryEntry, DictionaryMember, DictionaryMismatch, DictionaryValue, PageData, Technical } from '../lib/types';
import { ChunkNotice } from './ChunkNotice';
import { TableScroll } from './Tables';
import { SelectField } from './ui/Select';
import { Item, ItemField, ItemList } from './ui/ItemList';
import { StatStrip } from './ui/StatStrip';
import { FilterToolbar, SearchField } from './ui/Toolbar';
import { PageTitle } from '../lib/outline';

/** The bucket of the files that belong to no application. */
const NO_APPLICATION = '';

/** Every value set when `application` is null, else those of that application; and, with a query, those whose name holds it, in any case. A new list; the given one is not changed. */
export function filterDictionaries(list: DictionaryEntry[], application: string | null, query: string): DictionaryEntry[] {
  const needle = query.trim().toLowerCase();
  return list.filter((entry) => (application === null || entry.application === application) && (needle === '' || entry.name.toLowerCase().includes(needle)));
}

const place = (t: Text, file: string, line: number): string => t('md.locations.placeOne', { file, line });
const formKey = (form: string): string => `md.dict.form.${form.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`;
const applicationLabel = (t: Text, key: string): string => (key === NO_APPLICATION ? t('md.data.noApplication') : key);
/** A value as the notes of a mismatch write it: a string in quotes, a number as it is. */
const valueText = (value: string | number): string => (typeof value === 'string' ? JSON.stringify(value) : String(value));
const side = (t: Text, item: { id: string; application: string }): string => t('md.dict.mismatch.side', { id: item.id, application: applicationLabel(t, item.application) });
const valuesText = (t: Text, list: DictionaryValue[]): string => list.map((entry) => t('md.dict.mismatch.valueItem', { value: valueText(entry.value), members: entry.members.join(', ') })).join(', ');

function description(t: Text, entry: DictionaryEntry): string {
  const where = place(t, entry.file, entry.line);
  if (entry.form === 'go-type') return t('md.dict.set.goType', { baseType: entry.baseType ?? '', place: where });
  if (entry.form === 'ts-enum') return t('md.dict.set.tsEnum', { place: where });
  if (entry.form === 'ts-const-object') return t('md.dict.set.tsConstObject', { place: where });
  return t('md.dict.set.jsObject', { place: where });
}

/** The value cell: a number is set right, a string carries its kind so the stylesheet draws the quotes, a value that was not computed says so. */
function ValueCell({ member }: { member: DictionaryMember }) {
  const t = useText();
  if (!member.computed) return <td>{member.value === null ? t('md.dict.notComputed') : t('md.dict.valueNotComputed', { value: member.value })}</td>;
  if (typeof member.value === 'string') return <td data-kind="string">{member.value}</td>;
  return <td className="num">{member.value}</td>;
}

/** The value of a member as one line of an item (the stylesheet draws the quotes of a string); a value that was not computed says so. */
function valueLine(t: Text, member: DictionaryMember): string {
  if (!member.computed) return member.value === null ? t('md.dict.notComputed') : t('md.dict.valueNotComputed', { value: member.value });
  return String(member.value);
}

/** A list of texts as one text, or a list when there are several. */
function TextList({ items }: { items: string[] }) {
  return items.length === 1 ? <>{items[0]}</> : <ul className="rule-list">{items.map((item, at) => <li key={at}>{item}</li>)}</ul>;
}

/** A set whose members carry comments or display names (free text) is a list of blocks; a set of bare members, all short values, is a table. */
function SetMembers({ entry }: { entry: DictionaryEntry }) {
  const t = useText();
  const hasText = entry.members.some((member) => member.comments.length > 0 || member.labels.length > 0);
  if (!hasText) {
    return (
      <TableScroll label={entry.name}>
        <thead>
          <tr>
            <th scope="col">{t('md.dict.table.member')}</th>
            <th scope="col">{t('md.dict.table.value')}</th>
            <th scope="col">{t('md.dict.table.location')}</th>
          </tr>
        </thead>
        <tbody>
          {entry.members.map((member, at) => (
            <tr key={at}>
              <th scope="row">{member.name}</th>
              <ValueCell member={member} />
              <td>{place(t, member.file, member.line)}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
    );
  }
  return (
    <ItemList part="dict-members" label={entry.name}>
      {entry.members.map((member, at) => (
        <Item
          key={at}
          attrs={(
            <>
              <span>{member.name}</span>
              <code className="item-code" data-kind={member.computed && typeof member.value === 'string' ? 'string' : undefined}>{valueLine(t, member)}</code>
              <span className="item-place muted">{place(t, member.file, member.line)}</span>
            </>
          )}
          note={member.labels.length === 0 ? undefined : (
            <ItemField label={t('md.dict.table.names')}><TextList items={member.labels.map((label) => t('md.dict.labelItem', { text: label.text, place: place(t, label.file, label.line) }))} /></ItemField>
          )}
        >
          {member.comments.length > 0 && <ItemField label={t('md.dict.table.comment')}><TextList items={member.comments.map((comment) => comment.text)} /></ItemField>}
        </Item>
      ))}
    </ItemList>
  );
}

function SetTable({ entry }: { entry: DictionaryEntry }) {
  const t = useText();
  return (
    <section className="dict-set" data-set={entry.id} aria-label={entry.name}>
      <h5 className="dict-set-name">{entry.name}</h5>
      <p className="muted">{description(t, entry)}</p>
      {entry.skippedMembers > 0 && <p className="muted">{t('md.dict.set.skipped', { count: entry.skippedMembers })}</p>}
      <SetMembers entry={entry} />
    </section>
  );
}

function Mismatch({ row }: { row: DictionaryMismatch }) {
  const t = useText();
  return (
    <li>
      {t('md.dict.mismatch.item', { left: side(t, row.left), right: side(t, row.right) })}
      <ul className="rule-list">
        {row.onlyLeft.length > 0 && <li>{t('md.dict.mismatch.onlyIn', { side: side(t, row.left), values: valuesText(t, row.onlyLeft) })}</li>}
        {row.onlyRight.length > 0 && <li>{t('md.dict.mismatch.onlyIn', { side: side(t, row.right), values: valuesText(t, row.onlyRight) })}</li>}
        {row.both.length > 0 && <li>{t('md.dict.mismatch.both', { values: row.both.map((entry) => t('md.dict.mismatch.bothItem', { value: valueText(entry.value), left: entry.left.join(', '), right: entry.right.join(', ') })).join(', ') })}</li>}
        {row.uncompared.left.length > 0 && <li>{t('md.dict.mismatch.notCompared', { side: side(t, row.left), members: row.uncompared.left.join(', ') })}</li>}
        {row.uncompared.right.length > 0 && <li>{t('md.dict.mismatch.notCompared', { side: side(t, row.right), members: row.uncompared.right.join(', ') })}</li>}
      </ul>
    </li>
  );
}

/** The value sets by application and then by file, in the order of the list; an application with none left after filtering is not drawn. */
function Groups({ section, shown }: { section: DictionariesSection; shown: DictionaryEntry[] }) {
  const t = useText();
  return (
    <>
      {section.applications.map((application) => {
        const inApplication = shown.filter((entry) => entry.application === application.directory);
        if (inApplication.length === 0) return null;
        const files = [...new Set(inApplication.map((entry) => entry.file))];
        return (
          <section className="dict-application" key={application.directory} data-application={application.directory}>
            <h3 className="section-title">{t('md.dict.applicationHeading', { application: applicationLabel(t, application.directory) })}</h3>
            {files.map((file) => (
              <div className="dict-file" key={file}>
                <h4 className="dict-file-name">{file}</h4>
                {inApplication.filter((entry) => entry.file === file).map((entry) => <SetTable entry={entry} key={entry.id} />)}
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}

function SectionBody({ section }: { section: DictionariesSection }) {
  const t = useText();
  const [selected, setSelected] = useState<number>(-1);
  const [query, setQuery] = useState<string>('');
  const { counts } = section;
  const { candidates } = counts;
  const application = selected < 0 ? null : section.applications[selected]?.directory ?? null;
  const shown = filterDictionaries(section.dictionaries, application, query);
  return (
    <>
      <div className="summary-note" data-part="dict-note">
        {['md.dict.note.nameRule', 'md.dict.note.sources', 'md.dict.note.values'].map((key) => <p className="muted" key={key}>{t(key)}</p>)}
        <p className="muted">{t('md.dict.recognized', { forms: section.recognized.map((form) => t(formKey(form))).join('; ') })}</p>
      </div>
      <StatStrip part="dict-stats" stats={[
        { label: t('page.stat.valueSets'), value: counts.dictionaries.total },
        { label: t('page.stat.members'), value: counts.members.total },
        { label: t('page.stat.membersComputed'), value: counts.members.computed },
        { label: t('page.stat.membersNotComputed'), value: counts.members.notComputed },
        { label: t('page.stat.comments'), value: counts.comments },
        { label: t('page.stat.displayNames'), value: counts.labels },
        { label: t('page.stat.mismatches'), value: counts.mismatches },
        { label: t('page.stat.skippedMembers'), value: counts.skippedMembers },
      ]} />
      <p className="summary-counts">
        {t('md.dict.countLineNotTaken', {
          noConstants: candidates.goTypes.noConstants,
          duplicate: candidates.goTypes.duplicate,
          untypedIota: candidates.goConstants.untypedIota,
          otherType: candidates.goConstants.otherType,
          plain: candidates.goConstants.plain,
          otherVar: candidates.goVars.otherType,
          tsNoLiteral: candidates.tsConstObjects.noLiteralMembers,
          jsNoLiteral: candidates.jsObjects.noLiteralMembers,
          unmatchedKey: candidates.mapEntries.unmatchedKey,
          ambiguousKey: candidates.mapEntries.ambiguousKey,
        })}
      </p>
      <h2 className="section-title">{t('md.dict.mismatchHeading')}</h2>
      <p className="muted">{t('md.dict.mismatchNote')}</p>
      {section.mismatches.length === 0 ? <p className="muted">{t('md.none')}</p> : <ul className="rule-list" data-part="dict-mismatches">{section.mismatches.map((row, at) => <Mismatch row={row} key={at} />)}</ul>}
      <h2 className="section-title">{t('md.dict.byApplicationHeading')}</h2>
      <FilterToolbar part="dict-filters" status={t('page.dict.shown', { shown: shown.length, total: section.dictionaries.length })}>
        <SelectField
          name="application"
          label={t('page.dict.filter.application')}
          value={String(selected)}
          onValueChange={(next) => setSelected(Number(next))}
          options={[{ value: '-1', label: t('page.dict.filter.all') }, ...section.applications.map((row, at) => ({ value: String(at), label: applicationLabel(t, row.directory) }))]}
        />
        <SearchField label={t('page.dict.filter.search')} value={query} onChange={setQuery} />
      </FilterToolbar>
      {section.dictionaries.length === 0 && <p className="muted">{t('md.none')}</p>}
      {section.dictionaries.length > 0 && shown.length === 0 && <p className="muted" data-part="dict-no-match">{t('page.dict.noMatch')}</p>}
      <Groups section={section} shown={shown} />
    </>
  );
}

/** The technical view's status dictionary page: the value sets the code declares with the comments and display names it gives them; the same content as the handbook's status dictionary part, filterable by application and searchable by name. A dictionary that was not written, or is malformed, is one line. */
export function DictionariesPage({ data, technical }: { data: PageData; technical: Technical }) {
  const t = useText();
  const { dictionariesState } = technical;
  const detail = useDictionaries(technical.dictionaries);
  return (
    <article className="page" data-view="dictionaries">
      <header className="page-head">
        <p className="eyebrow">{systemName(data.project, t)}</p>
        <PageTitle fallback={t('md.dict.heading')} />
      </header>
      {detail.status !== 'ready' ? <ChunkNotice state={detail} /> : detail.value === null
        ? <p className="muted" data-part="dict-status">{t(dictionariesState === 'malformed' ? 'md.dict.malformed' : 'md.dict.notWritten')}</p>
        : <SectionBody section={detail.value} />}
    </article>
  );
}
