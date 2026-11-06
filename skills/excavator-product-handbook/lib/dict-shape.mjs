/**
 * The shape of `dictionaries.json` and its counts (openspec change
 * handbook-status-dictionary, design D1 and D4). As for `data.json`
 * (data-shape.mjs), the counts are computed from the lists here and nowhere
 * else: the extraction writes them with `computeDictionaryCounts`, and the
 * check recomputes them, and the mismatches, from the lists it reads, so a
 * number or a list that disagrees with what it summarizes is a problem and a
 * renderer can read `counts` without counting again.
 */

import { computeMismatches } from './dict-compare.mjs';
import { isObject } from './json-file.mjs';

export const DICT_FORMAT = 'excavator-product-handbook-dictionaries/1';
/** The forms this version recognizes; the page words each by its key. */
export const DICT_RECOGNIZED = Object.freeze(['go-named-type', 'ts-enum', 'js-object']);

const FORMS = Object.freeze(['go-type', 'ts-enum', 'js-object']);
/** The buckets a candidate of each kind can land in. */
export const CANDIDATE_BUCKETS = Object.freeze({
  'go-type': Object.freeze(['dictionary', 'noConstants', 'duplicate']),
  'go-const': Object.freeze(['member', 'untypedIota', 'otherType', 'plain']),
  'ts-enum': Object.freeze(['dictionary']),
  'js-object': Object.freeze(['dictionary', 'noLiteralMembers']),
  'map-entry': Object.freeze(['label', 'unmatchedKey', 'ambiguousKey']),
});

/** The counts of a dictionaries object whose lists are well formed. */
export function computeDictionaryCounts(data) {
  const ofForm = (form) => data.dictionaries.filter((entry) => entry.form === form).length;
  const bucketCounts = (kind) => {
    const rows = data.candidates.filter((row) => row.kind === kind);
    return { total: rows.length, ...Object.fromEntries(CANDIDATE_BUCKETS[kind].map((bucket) => [bucket, rows.filter((row) => row.bucket === bucket).length])) };
  };
  const members = data.dictionaries.flatMap((entry) => entry.members);
  return {
    dictionaries: { total: data.dictionaries.length, goType: ofForm('go-type'), tsEnum: ofForm('ts-enum'), jsObject: ofForm('js-object') },
    members: { total: members.length, computed: members.filter((member) => member.computed).length, notComputed: members.filter((member) => !member.computed).length },
    comments: members.reduce((sum, member) => sum + member.comments.length, 0),
    labels: members.reduce((sum, member) => sum + member.labels.length, 0),
    skippedMembers: data.dictionaries.reduce((sum, entry) => sum + entry.skippedMembers, 0),
    candidates: {
      goTypes: bucketCounts('go-type'),
      goConstants: bucketCounts('go-const'),
      tsEnums: bucketCounts('ts-enum'),
      jsObjects: bucketCounts('js-object'),
      mapEntries: bucketCounts('map-entry'),
    },
    mismatches: data.mismatches.length,
  };
}

const isString = (value) => typeof value === 'string' && value !== '';
const isText = (value) => typeof value === 'string';
const isLine = (value) => Number.isInteger(value) && value >= 1;
const isCount = (value) => Number.isInteger(value) && value >= 0;
const oneOf = (list) => (value) => list.includes(value);
const optional = (test) => (value) => value === undefined || test(value);
const isValue = (value) => value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
const isList = (test) => (value) => Array.isArray(value) && value.every(test);

/** Check an array of rows with a field test per key; problems name `path[i].key`. Returns whether every row is well formed. */
function rows(problems, value, path, fields) {
  if (!Array.isArray(value)) {
    problems.push(`${path} is not a list`);
    return false;
  }
  let ok = true;
  value.forEach((row, i) => {
    if (!isObject(row)) {
      problems.push(`${path}[${i}] is not an object`);
      ok = false;
      return;
    }
    for (const [key, test] of Object.entries(fields)) {
      if (!test(row[key], row)) {
        problems.push(`${path}[${i}].${key} is not valid`);
        ok = false;
      }
    }
  });
  return ok;
}

const comment = (value) => isObject(value) && isText(value.text) && isString(value.file) && isLine(value.line) && optional(isLine)(value.endLine) && ['above', 'same-line'].includes(value.where);
const label = (value) => isObject(value) && isText(value.text) && isString(value.file) && isLine(value.line);
const valueEntry = (value) => isObject(value) && isValue(value.value) && value.value !== null && isList(isText)(value.members);
const mismatchSide = (value) => isObject(value) && isString(value.id) && typeof value.application === 'string' && isString(value.name);

/** The member rows' own consistency: a computed member has a value, a member that is not has a reason. */
function memberProblems(problems, dictionaries) {
  dictionaries.forEach((entry, i) => {
    entry.members.forEach((member, k) => {
      if (member.computed && member.value === null) problems.push(`dictionaries[${i}].members[${k}] is computed and has no value`);
      if (!member.computed && !['expression', 'after-uncomputed'].includes(member.reason)) problems.push(`dictionaries[${i}].members[${k}] is not computed and has no reason`);
    });
  });
}

/** Problems of a `dictionaries.json` value, one line each; an empty list means the shape holds. */
export function checkDictionariesShape(value) {
  if (!isObject(value)) return ['dictionaries.json is not a JSON object'];
  const problems = [];
  if (value.format !== DICT_FORMAT) problems.push(`format is ${JSON.stringify(value.format)}, expected ${DICT_FORMAT}`);
  if (!Array.isArray(value.recognized) || !value.recognized.every((key) => DICT_RECOGNIZED.includes(key))) problems.push('recognized is not a list of known form keys');

  const lists = [
    rows(problems, value.applications, 'applications', { directory: isText, dictionaries: isCount }),
    rows(problems, value.dictionaries, 'dictionaries', {
      id: isString,
      application: isText,
      form: oneOf(FORMS),
      name: isString,
      file: isString,
      line: isLine,
      baseType: (v, row) => (row.form === 'go-type' ? isString(v) : v === undefined),
      members: (v) => Array.isArray(v) && v.every((m) => isObject(m) && isText(m.name) && isValue(m.value) && typeof m.computed === 'boolean' && optional(isString)(m.reason) && isString(m.file) && isLine(m.line) && Array.isArray(m.comments) && m.comments.every(comment) && Array.isArray(m.labels) && m.labels.every(label)),
      skippedMembers: isCount,
    }),
    rows(problems, value.candidates, 'candidates', {
      kind: oneOf(Object.keys(CANDIDATE_BUCKETS)),
      file: isString,
      line: isLine,
      bucket: (v, row) => (CANDIDATE_BUCKETS[row.kind] ?? []).includes(v),
      name: (v, row) => (row.kind === 'map-entry' ? v === undefined : isString(v)),
      key: (v, row) => (row.kind === 'map-entry' ? isString(v) : v === undefined),
      type: optional(isString),
      dictionary: optional(isString),
      member: optional(isText),
    }),
    rows(problems, value.mismatches, 'mismatches', {
      key: isString, left: mismatchSide, right: mismatchSide, onlyLeft: isList(valueEntry), onlyRight: isList(valueEntry),
      both: isList((v) => isObject(v) && isValue(v.value) && isList(isText)(v.left) && isList(isText)(v.right)),
      uncompared: (v) => isObject(v) && isList(isText)(v.left) && isList(isText)(v.right),
    }),
  ];
  if (!isObject(value.scanned) || !['filesSearched', 'skippedBinary', 'skippedTooLarge', 'skippedUnreadable'].every((key) => isCount(value.scanned[key]))) problems.push('scanned does not hold the file counts');
  if (!isObject(value.counts)) problems.push('counts is not an object');
  if (problems.length > 0 || !lists.every(Boolean)) return problems;

  const ids = new Set();
  for (const entry of value.dictionaries) {
    if (ids.has(entry.id)) problems.push(`dictionary ${entry.id} is listed twice`);
    ids.add(entry.id);
  }
  memberProblems(problems, value.dictionaries);
  const pointed = new Map();
  value.candidates.forEach((row, i) => {
    if (row.dictionary !== undefined && !ids.has(row.dictionary)) problems.push(`candidates[${i}] points at ${row.dictionary}, which is not in dictionaries`);
    if (['dictionary', 'member', 'label'].includes(row.bucket) && row.dictionary === undefined) problems.push(`candidates[${i}] is in the ${row.bucket} bucket and names no dictionary`);
    if (row.bucket === 'dictionary') pointed.set(row.dictionary, (pointed.get(row.dictionary) ?? 0) + 1);
  });
  for (const id of ids) if (pointed.get(id) !== 1) problems.push(`dictionary ${id} is pointed at ${pointed.get(id) ?? 0} times by the dictionary rows, expected once`);
  const goMembers = value.dictionaries.filter((entry) => entry.form === 'go-type').reduce((sum, entry) => sum + entry.members.length, 0);
  if (value.candidates.filter((row) => row.bucket === 'member').length !== goMembers) problems.push('the member rows are not the members of the Go dictionaries');
  const labels = value.dictionaries.reduce((sum, entry) => sum + entry.members.reduce((inner, member) => inner + member.labels.length, 0), 0);
  if (value.candidates.filter((row) => row.bucket === 'label').length !== labels) problems.push('the label rows are not the display names of the members');
  const total = value.applications.reduce((sum, app) => sum + app.dictionaries, 0);
  if (total !== value.dictionaries.length) problems.push('the dictionaries of the applications do not add up to the dictionaries');
  if (problems.length > 0) return problems;

  if (JSON.stringify(computeMismatches(value.dictionaries)) !== JSON.stringify(value.mismatches)) problems.push('mismatches are not the ones the dictionaries give');
  const computed = computeDictionaryCounts(value);
  for (const [key, expected] of Object.entries(computed)) {
    if (JSON.stringify(value.counts[key]) !== JSON.stringify(expected)) problems.push(`counts.${key} is ${JSON.stringify(value.counts[key])}, the lists give ${JSON.stringify(expected)}`);
  }
  for (const key of Object.keys(value.counts)) if (!(key in computed)) problems.push(`counts.${key} is not a known count`);
  return problems;
}
