/**
 * Go value sets from the files of a project (openspec change
 * handbook-status-dictionary, design D2 and D4). Types and constants meet per
 * directory, since a package's types and constants are often in different
 * files. Each named type lands in `dictionary` (some constant is declared
 * with it), `noConstants`, or `duplicate` (declared again in the same
 * directory: its constants belong to the first declaration, which Go build
 * tags can make ambiguous). Each constant item lands in `member`,
 * `untypedIota` (no type, uses `iota`), `otherType` (a type that is not a
 * named basic type of the directory) or `plain`. A typed var with a value is
 * a `go-var` row, `member` or `otherType`, and its member says `declaredAs: 'var'`.
 */

import { makeMember } from './dict-member.mjs';

const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `files` are `{ rel, application, directory, read }` with `read` from
 * `readGoFile`. Returns `{ dictionaries, candidates, goMembers }`; the
 * candidate rows point at dictionaries by object, `goMembers` are what
 * display names are resolved against.
 */
export function assembleGo(files) {
  const byDirectory = new Map();
  for (const file of files) byDirectory.set(file.directory, [...(byDirectory.get(file.directory) ?? []), file]);
  const dictionaries = [];
  const candidates = [];
  const goMembers = [];
  for (const directory of [...byDirectory.keys()].sort(byteOrder)) {
    const list = byDirectory.get(directory).sort((a, b) => byteOrder(a.rel, b.rel));
    const declared = new Map();
    const typeRows = [];
    for (const file of list) {
      for (const type of file.read.types) {
        const row = { kind: 'go-type', file: file.rel, line: type.line, name: type.name };
        if (declared.has(type.name)) {
          candidates.push({ ...row, bucket: 'duplicate', dictionary: declared.get(type.name) });
          continue;
        }
        const dictionary = { application: file.application, form: 'go-type', name: type.name, file: file.rel, line: type.line, baseType: type.base, members: [], skippedMembers: 0 };
        declared.set(type.name, dictionary);
        typeRows.push({ row, dictionary });
      }
    }
    for (const file of list) {
      for (const item of file.read.items) {
        const row = { kind: item.declaredAs === 'var' ? 'go-var' : 'go-const', file: file.rel, line: item.line, name: item.name, ...(item.typeText === null ? {} : { type: item.typeText }) };
        const dictionary = item.typeText === null ? undefined : declared.get(item.typeText);
        if (dictionary !== undefined) {
          const member = makeMember(item, file.rel);
          dictionary.members.push(member);
          goMembers.push({ application: file.application, directory, pkg: file.read.package, member, dictionary });
          candidates.push({ ...row, bucket: 'member', dictionary });
        } else if (item.typeText !== null) candidates.push({ ...row, bucket: 'otherType' });
        else candidates.push({ ...row, bucket: item.usesIota ? 'untypedIota' : 'plain' });
      }
    }
    for (const { row, dictionary } of typeRows) {
      if (dictionary.members.length === 0) candidates.push({ ...row, bucket: 'noConstants' });
      else {
        dictionaries.push(dictionary);
        candidates.push({ ...row, bucket: 'dictionary', dictionary });
      }
    }
  }
  return { dictionaries, candidates, goMembers };
}
