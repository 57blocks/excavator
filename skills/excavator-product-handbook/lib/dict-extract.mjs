/**
 * The status dictionary's extraction (openspec change
 * handbook-status-dictionary, design D2 to D5 and D7): read the project's
 * source statically, never build or run it, and return the object
 * `dictionaries.json` holds. Zero model calls; the same project gives the same
 * object, with no run time and no local path. Each file is read once; every
 * candidate (a named type, a constant item, an enum, an object, a map entry)
 * lands in exactly one named bucket of `candidates`.
 */

import { assembleGo } from './dict-go-assemble.mjs';
import { computeMismatches } from './dict-compare.mjs';
import { NO_APPLICATION, byteOrder, listProject, readText } from './data-files.mjs';
import { readGoFile } from './dict-go.mjs';
import { readJsObjects } from './dict-js.mjs';
import { readGoMapEntries, readTsLabelEntries, resolveLabels } from './dict-labels.mjs';
import { makeMember } from './dict-member.mjs';
import { DICT_FORMAT, DICT_RECOGNIZED, computeDictionaryCounts } from './dict-shape.mjs';
import { readSource } from './dict-text.mjs';
import { readTsEnums } from './dict-ts.mjs';

const TS_EXTENSIONS = Object.freeze(['ts', 'tsx', 'mts', 'cts']);
const JS_EXTENSIONS = Object.freeze(['js', 'jsx', 'mjs', 'cjs']);

const extensionOf = (rel) => {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
};
const dirOf = (rel) => rel.slice(0, Math.max(rel.lastIndexOf('/'), 0));
const byPlace = (a, b) => byteOrder(a.file, b.file) || a.line - b.line || byteOrder(a.name ?? a.key ?? '', b.name ?? b.key ?? '') || byteOrder(a.kind ?? '', b.kind ?? '');

/** Read every Go, TypeScript and JavaScript file once; returns the readings and what the pass skipped. */
function readFiles(files) {
  const skipped = { binary: 0, tooLarge: 0, unreadable: 0 };
  let searched = 0;
  const go = [];
  const goEntries = [];
  const tsEntries = [];
  const dictionaries = [];
  const candidates = [];
  for (const file of files) {
    const ext = extensionOf(file.rel);
    const kind = ext === 'go' ? 'go' : TS_EXTENSIONS.includes(ext) ? 'ts' : JS_EXTENSIONS.includes(ext) ? 'js' : null;
    if (kind === null) continue;
    const read = readText(file);
    if (read.skipped !== undefined) {
      skipped[read.skipped] += 1;
      continue;
    }
    searched += 1;
    const source = readSource(read.text, kind === 'go' ? 'go' : 'js');
    const place = { file: file.rel, application: file.application };
    if (kind === 'go') {
      const directory = dirOf(file.rel);
      go.push({ rel: file.rel, application: file.application, directory, read: readGoFile(source) });
      goEntries.push(...readGoMapEntries(source).map((entry) => ({ ...place, directory, ...entry })));
    } else if (kind === 'ts') {
      for (const found of readTsEnums(source)) {
        const dictionary = { application: file.application, form: 'ts-enum', name: found.name, file: file.rel, line: found.line, members: found.members.map((member) => makeMember(member, file.rel)), skippedMembers: found.skippedMembers };
        dictionaries.push(dictionary);
        candidates.push({ kind: 'ts-enum', file: file.rel, line: found.line, name: found.name, bucket: 'dictionary', dictionary });
      }
      tsEntries.push(...readTsLabelEntries(source).map((entry) => ({ ...place, ...entry })));
    } else {
      for (const found of readJsObjects(source)) {
        const row = { kind: 'js-object', file: file.rel, line: found.line, name: found.name };
        if (found.members.length === 0) {
          candidates.push({ ...row, bucket: 'noLiteralMembers' });
          continue;
        }
        const members = found.members.map((member) => makeMember(member, file.rel));
        const dictionary = { application: file.application, form: 'js-object', name: found.name, file: file.rel, line: found.line, members, skippedMembers: found.skippedMembers };
        dictionaries.push(dictionary);
        candidates.push({ ...row, bucket: 'dictionary', dictionary });
        for (const entry of found.tableEntries) {
          const member = members[found.members.indexOf(entry.member)];
          member.labels.push({ text: entry.text, file: file.rel, line: entry.line });
          candidates.push({ kind: 'map-entry', file: file.rel, line: entry.line, key: entry.key, bucket: 'label', dictionary, member: member.name });
        }
      }
    }
  }
  return { go, goEntries, tsEntries, dictionaries, candidates, skipped, searched };
}

/** Give each dictionary its id, `<file>:<name>`; a second one with the same id (the same name twice in a file) gets `#<line>` as well. */
function assignIds(dictionaries) {
  const seen = new Set();
  for (const dictionary of dictionaries) {
    let id = `${dictionary.file}:${dictionary.name}`;
    if (seen.has(id)) id = `${id}#${dictionary.line}`;
    seen.add(id);
    dictionary.id = id;
  }
}

/** The dictionaries as written: `id` first, the members sorted by place for Go (a type's constants may be in several files). */
const written = (dictionary) => {
  const { id, application, form, name, file, line, baseType, members, skippedMembers } = dictionary;
  return { id, application, form, name, file, line, ...(baseType === undefined ? {} : { baseType }), members, skippedMembers };
};

/** Extract the status dictionary's facts from the project at `projectRootArg`. */
export function extractDictionaries(projectRootArg) {
  const project = listProject(projectRootArg);
  const read = readFiles(project.files);
  const assembled = assembleGo(read.go);
  const dictionaries = [...read.dictionaries, ...assembled.dictionaries].sort(byPlace);
  assignIds(dictionaries);
  const labelRows = resolveLabels({ goEntries: read.goEntries, tsEntries: read.tsEntries, goMembers: assembled.goMembers, dictionaries });
  const candidates = [...read.candidates, ...assembled.candidates, ...labelRows]
    .map((row) => (row.dictionary === undefined ? row : { ...row, dictionary: row.dictionary.id }))
    .sort(byPlace);
  const applications = project.roots.map((directory) => ({ directory, dictionaries: dictionaries.filter((entry) => entry.application === directory).length }));
  const outside = dictionaries.filter((entry) => entry.application === NO_APPLICATION).length;
  if (outside > 0) applications.push({ directory: NO_APPLICATION, dictionaries: outside });

  const data = {
    format: DICT_FORMAT,
    recognized: [...DICT_RECOGNIZED],
    applications,
    dictionaries: dictionaries.map(written),
    candidates,
    mismatches: computeMismatches(dictionaries),
    scanned: { filesSearched: read.searched, skippedBinary: read.skipped.binary, skippedTooLarge: read.skipped.tooLarge, skippedUnreadable: read.skipped.unreadable },
  };
  data.counts = computeDictionaryCounts(data);
  return data;
}
