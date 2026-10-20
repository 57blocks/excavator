/**
 * groups.mjs
 *
 * Feature groups for the hotspots product (openspec: changes/hotspots-by-feature).
 * A groups file names groups of files: `{ "groups": [ { "name", "paths" } ] }`.
 * A path is a selected file, or a directory ending in `/` that stands for every
 * selected file below it; a path without the `/` matches a file of that name only.
 * A path that matches no selected file is kept in the group's `unmatchedPaths`,
 * never dropped, and a file listed twice in one group counts once. Which files
 * make up a feature is the groups file's claim; nothing here checks it.
 */

import { readFileSync } from 'node:fs';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The groups of a groups file's text, or an Error that says what is wrong with it.
 *
 * @param {string} text
 * @returns {Array<{ name: string, paths: string[] }>}
 */
export function parseGroups(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`groups file is not JSON: ${error.message}`);
  }
  if (!isObject(value) || !Array.isArray(value.groups)) throw new Error('groups file must be an object with a "groups" array');
  const names = new Set();
  return value.groups.map((group, at) => {
    if (!isObject(group)) throw new Error(`groups[${at}] must be an object`);
    const { name, paths } = group;
    if (typeof name !== 'string' || name.length === 0) throw new Error(`groups[${at}].name must be a non-empty string`);
    if (names.has(name)) throw new Error(`groups[${at}].name ${JSON.stringify(name)} is used by another group`);
    names.add(name);
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) {
      throw new Error(`groups[${at}].paths must be an array of strings`);
    }
    return { name, paths: [...paths] };
  });
}

/** The groups of the groups file at `path`; an Error when it cannot be read or is malformed. */
export function readGroupsFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    throw new Error(`groups file cannot be read: ${error.message}`);
  }
  return parseGroups(text);
}

/**
 * Each group's selected files, in the order the selection lists them, and the paths that matched none.
 *
 * @param {Array<{ name: string, paths: string[] }>} groups
 * @param {string[]} selected the selected files' paths
 * @returns {Array<{ name: string, paths: string[], unmatchedPaths: string[], files: string[] }>}
 */
export function matchGroups(groups, selected) {
  const isSelected = new Set(selected);
  return groups.map(({ name, paths }) => {
    const members = new Set();
    const unmatchedPaths = [];
    for (const path of paths) {
      const matched = path.endsWith('/') ? selected.filter((file) => file.startsWith(path)) : isSelected.has(path) ? [path] : [];
      if (matched.length === 0) unmatchedPaths.push(path);
      for (const file of matched) members.add(file);
    }
    return { name, paths, unmatchedPaths, files: selected.filter((file) => members.has(file)) };
  });
}

/**
 * The product header's counts over matched groups: how many groups, how many
 * selected files are in at least one and in more than one, and how many listed
 * paths matched no selected file.
 *
 * @param {Array<{ unmatchedPaths: string[], files: string[] }>} matched from `matchGroups`
 */
export function countGroups(matched) {
  const groupsOf = new Map();
  for (const group of matched) for (const file of group.files) groupsOf.set(file, (groupsOf.get(file) ?? 0) + 1);
  return {
    groupsListed: matched.length,
    filesInAGroup: groupsOf.size,
    filesInSeveralGroups: [...groupsOf.values()].filter((count) => count > 1).length,
    pathsUnmatched: matched.reduce((sum, group) => sum + group.unmatchedPaths.length, 0),
  };
}

export default { parseGroups, readGroupsFile, matchGroups, countGroups };
