/**
 * The status dictionary part of the technical handbook (openspec change
 * handbook-status-dictionary, design D6), written from the checked
 * dictionaries.json. A part of the data chapter, after the tables. Every fixed
 * text is a ui key; names, values, comments, display names and places are the
 * script's, and the counts are read from `counts`, never recounted here.
 */

import { NO_APPLICATION } from './data-files.mjs';
import { dictFormKey } from './dict-section.mjs';
import { inline, table } from './markdown.mjs';
import { fill } from './ui.mjs';

const placeOf = (file, line, t) => fill(t('md.locations.placeOne'), { file, line });

/** A value as the tables write it: a string in quotes, a number as it is. */
export const valueText = (value) => (typeof value === 'string' ? JSON.stringify(value) : String(value));

/** The value cell of a member: not computed values are written as in the code with the mark, or the mark alone when there is none. */
export function memberValueText(member, t) {
  if (member.computed) return valueText(member.value);
  return member.value === null ? t('md.dict.notComputed') : fill(t('md.dict.valueNotComputed'), { value: member.value });
}

export const applicationLabel = (application, t) => (application === NO_APPLICATION ? t('md.data.noApplication') : application);

const sideText = (side, t) => fill(t('md.dict.mismatch.side'), { id: side.id, application: applicationLabel(side.application, t) });
const valuesText = (list, t) => list.map((entry) => fill(t('md.dict.mismatch.valueItem'), { value: valueText(entry.value), members: entry.members.join(', ') })).join(', ');

/** The lines of one mismatch: the two value sets, then what only one side has, what both have and what was not compared. */
function mismatchLines(row, t) {
  const out = [`- ${inline(fill(t('md.dict.mismatch.item'), { left: sideText(row.left, t), right: sideText(row.right, t) }))}`];
  for (const [side, list] of [[row.left, row.onlyLeft], [row.right, row.onlyRight]]) {
    if (list.length > 0) out.push(`  - ${inline(fill(t('md.dict.mismatch.onlyIn'), { side: sideText(side, t), values: valuesText(list, t) }))}`);
  }
  if (row.both.length > 0) {
    const values = row.both.map((entry) => fill(t('md.dict.mismatch.bothItem'), { value: valueText(entry.value), left: entry.left.join(', '), right: entry.right.join(', ') })).join(', ');
    out.push(`  - ${inline(fill(t('md.dict.mismatch.both'), { values }))}`);
  }
  for (const [side, names] of [[row.left, row.uncompared.left], [row.right, row.uncompared.right]]) {
    if (names.length > 0) out.push(`  - ${inline(fill(t('md.dict.mismatch.notCompared'), { side: sideText(side, t), members: names.join(', ') }))}`);
  }
  return out;
}

/** The place and the form of a value set as one sentence. */
export function setDescription(entry, t) {
  const place = placeOf(entry.file, entry.line, t);
  if (entry.form === 'go-type') return fill(t('md.dict.set.goType'), { baseType: entry.baseType, place });
  if (entry.form === 'ts-enum') return fill(t('md.dict.set.tsEnum'), { place });
  if (entry.form === 'ts-const-object') return fill(t('md.dict.set.tsConstObject'), { place });
  return fill(t('md.dict.set.jsObject'), { place });
}

/** The display names of a member, one per line of the cell, each with the place of its mapping table entry. */
export const namesText = (member, t) => member.labels.map((label) => inline(fill(t('md.dict.labelItem'), { text: label.text, place: placeOf(label.file, label.line, t) }))).join('<br>');

function setLines(entry, t) {
  const out = [`###### ${inline(entry.name)}`, '', setDescription(entry, t), ''];
  if (entry.skippedMembers > 0) out.push(fill(t('md.dict.set.skipped'), { count: entry.skippedMembers }), '');
  out.push(table(
    [t('md.dict.table.member'), t('md.dict.table.value'), t('md.dict.table.names'), t('md.dict.table.comment'), t('md.dict.table.location')],
    entry.members.map((member) => [member.name, memberValueText(member, t), namesText(member, t), member.comments.map((comment) => inline(comment.text)).join('<br>'), placeOf(member.file, member.line, t)]),
  ), '');
  return out;
}

/** The value sets by application and then by file, in the order of the list (by file and line within an application). */
function bySets(data, t) {
  const out = [];
  for (const application of data.applications) {
    const inApplication = data.dictionaries.filter((entry) => entry.application === application.directory);
    if (inApplication.length === 0) continue;
    out.push(`#### ${inline(fill(t('md.dict.applicationHeading'), { application: applicationLabel(application.directory, t) }))}`, '');
    const files = [...new Set(inApplication.map((entry) => entry.file))];
    for (const file of files) {
      out.push(`##### ${inline(file)}`, '');
      for (const entry of inApplication.filter((candidate) => candidate.file === file)) out.push(...setLines(entry, t));
    }
  }
  return out;
}

/** The count lines: what the lists hold, then what was looked at and not taken as a value set. */
export function countLines(counts, t) {
  const { candidates } = counts;
  return [
    fill(t('md.dict.countLine'), {
      total: counts.dictionaries.total,
      goType: counts.dictionaries.goType,
      tsEnum: counts.dictionaries.tsEnum,
      tsConstObject: counts.dictionaries.tsConstObject,
      jsObject: counts.dictionaries.jsObject,
      members: counts.members.total,
      computed: counts.members.computed,
      notComputed: counts.members.notComputed,
      comments: counts.comments,
      labels: counts.labels,
      mismatches: counts.mismatches,
      skipped: counts.skippedMembers,
    }),
    fill(t('md.dict.countLineNotTaken'), {
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
    }),
  ];
}

/**
 * The lines of the part. `section` is `loadDictionariesSection`'s result: a
 * missing or malformed dictionaries.json is the heading and one line.
 */
export function dictionaryBlock(section, t) {
  const out = [`### ${t('md.dict.heading')}`, ''];
  if (section.state === 'missing') return [...out, t('md.dict.notWritten'), ''];
  if (section.state === 'malformed') return [...out, t('md.dict.malformed'), ''];
  const { data } = section;
  out.push(...['md.dict.note.nameFilter', 'md.dict.note.meaning', 'md.dict.note.values'].flatMap((key) => [t(key), '']));
  out.push(fill(t('md.dict.recognized'), { forms: data.recognized.map((form) => t(dictFormKey(form))).join('; ') }), '');
  out.push(...countLines(data.counts, t).flatMap((line) => [line, '']));
  out.push(`#### ${t('md.dict.mismatchHeading')}`, '', t('md.dict.mismatchNote'), '');
  out.push(...(data.mismatches.length === 0 ? [t('md.none')] : data.mismatches.flatMap((row) => mismatchLines(row, t))), '');
  out.push(...(data.dictionaries.length === 0 ? [t('md.none'), ''] : bySets(data, t)));
  return out;
}
