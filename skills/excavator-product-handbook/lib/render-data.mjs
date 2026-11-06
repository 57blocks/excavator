/**
 * The data chapter of the technical handbook (openspec change
 * handbook-data-tables, design D5), written from the checked data.json. Every
 * fixed text is a ui key; table names, files and numbers are the script's.
 * Locations are rendered like the source locations of the other chapters
 * (`md.locations.*`). The counts are read from `counts`, never recounted here.
 */

import { NO_APPLICATION } from './data-files.mjs';
import { formKey } from './data-section.mjs';
import { inline, table } from './markdown.mjs';
import { fill } from './ui.mjs';

const DASH = '-';

const placeOf = (file, line, t) => fill(t('md.locations.placeOne'), { file, line });
const bullets = (items) => [...items.map((item) => `- ${inline(item)}`), ''];

/** The applications cell: a count per application where the name appears, or the fixed text when it appears only in migrations. */
function applicationsCell(entry, t) {
  const keys = Object.keys(entry.mentions);
  if (keys.length === 0) return t('md.data.onlyInMigrationsCell');
  return keys.map((key) => inline(fill(t('md.data.mentionCount'), { application: key === NO_APPLICATION ? t('md.data.noApplication') : key, count: entry.mentions[key].length }))).join('<br>');
}

function tablesRows(data, t) {
  return data.tables.map((entry) => [
    entry.name,
    entry.sources.length === 0 ? DASH : entry.sources.map((source) => inline(fill(t('md.data.source'), { kind: t(`md.data.kind.${source.kind}`), place: placeOf(source.file, source.line, t) }))).join('<br>'),
    applicationsCell(entry, t),
    entry.createdBy ?? DASH,
    entry.lastChangedBy ?? DASH,
  ]);
}

function gapsBlock(data, t) {
  const { gaps } = data;
  const out = [`### ${t('md.data.gapsHeading')}`, ''];
  const part = (key, items) => out.push(`#### ${t(key)}`, '', ...(items.length === 0 ? [t('md.none'), ''] : bullets(items)));
  part('md.data.gap.unnamedHeading', gaps.unnamedOperations.map((row) => fill(t('md.data.gap.unnamed'), { place: placeOf(row.file, row.line, t), op: row.op })));
  part('md.data.gap.unsplitHeading', gaps.unsplitMigrations.map((row) => row.file));
  part('md.data.gap.unresolvedHeading', gaps.unresolvedModelNames.map((row) => fill(t(row.matches === null ? 'md.data.gap.unresolved' : 'md.data.gap.unresolvedMatches'), { place: placeOf(row.file, row.line, t), expression: row.expression, matches: row.matches ?? 0 })));
  part('md.data.gap.otherHeading', gaps.otherMigrationFiles.map((row) => fill(t('md.data.gap.other'), { file: row.file, reason: t(`md.data.gap.reason.${row.reason}`) })));
  return out;
}

/**
 * The lines of the chapter. `section` is `loadDataSection`'s result: a missing
 * or malformed data.json is the heading and one line.
 */
export function dataBlock(section, t) {
  const out = [`## ${t('md.data.heading')}`, ''];
  if (section.state === 'missing') return [...out, t('md.data.notWritten'), ''];
  if (section.state === 'malformed') return [...out, t('md.data.malformed'), ''];
  const { data } = section;
  const { counts } = data;
  out.push(...[t('md.data.note.rules'), t('md.data.note.comments'), t('md.data.note.orm'), t('md.data.note.onlyInMigrations')].flatMap((line) => [line, '']));
  out.push(fill(t('md.data.recognized'), { forms: data.recognized.map((form) => t(formKey(form))).join('; ') }), '');
  out.push(fill(t('md.data.counts'), {
    tables: counts.tables,
    migrations: counts.migrations,
    replayed: counts.migrationsReplayed,
    unsplit: counts.migrationsUnsplit,
    downOnly: counts.migrationsDownOnly,
    several: counts.tablesInSeveralApplications,
    onlyInMigrations: counts.onlyInMigrations,
    dropped: counts.dropped,
    gaps: counts.gaps,
  }), '');
  out.push(`### ${t('md.data.migrationsHeading')}`, '');
  out.push(data.applications.length === 0
    ? t('md.none')
    : table([t('md.table.application'), t('md.data.table.migrations')], data.applications.map((row) => [row.directory === NO_APPLICATION ? t('md.data.noApplication') : row.directory, String(row.migrations)])), '');
  out.push(`### ${t('md.data.tablesHeading')}`, '');
  out.push(data.tables.length === 0
    ? t('md.none')
    : table([t('md.data.table.name'), t('md.data.table.declared'), t('md.data.table.applications'), t('md.data.table.createdBy'), t('md.data.table.lastChangedBy')], tablesRows(data, t)), '');
  out.push(`### ${t('md.data.droppedHeading')}`, '');
  out.push(data.dropped.length === 0
    ? t('md.none')
    : table([t('md.data.table.name'), t('md.data.table.createdBy'), t('md.data.table.droppedBy')], data.dropped.map((row) => [row.name, row.createdBy ?? DASH, placeOf(row.file, row.line, t)])), '');
  for (const [heading, names] of [['md.data.declaredOnlyHeading', data.declaredOnly], ['md.data.changedNeverCreatedHeading', data.changedNeverCreated], ['md.data.onlyInMigrationsHeading', data.onlyInMigrations]]) {
    out.push(`### ${t(heading)}`, '', ...(names.length === 0 ? [t('md.none'), ''] : bullets(names)));
  }
  out.push(...gapsBlock(data, t));
  return out;
}
