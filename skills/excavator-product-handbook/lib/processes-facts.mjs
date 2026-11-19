/**
 * `handbook.mjs processes facts <out>`: the reading list of the writer of the business-processes chapter (openspec change
 * handbook-process-review, design D7), read from map.json, the run's fixed text, the feature chapters and domains.json,
 * printed in map order and never written to a file:
 *
 *   OP       <F> <F>.md:<line> <title>      one per level-3 heading of the feature chapter's operations section
 *   UNREAD   <F> <reason>                   a feature with no chapter or no operations section: its operations are not listed
 *   EDGE     <F> <G> <F>.md:<line>          a list item of the hand-overs section of F that names another map feature G
 *   HANDOVER <from> -> <to>: <what>         one per entry of domains.json
 *   Counts:  ...
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readMapOrNull } from './item-numbers.mjs';
import { readJson } from './json-file.mjs';
import { featureParts } from './processes-parse.mjs';
import { findPart } from './processes-parts.mjs';
import { loadUi } from './ui.mjs';

/** One pass over the map's features: per feature its OP or UNREAD lines and its EDGE records, in map order. */
function collect(outDir, map, ui) {
  const ids = new Set(map.features.map((feature) => feature.id));
  const features = [];
  for (const { id } of map.features) {
    const entry = { id, rows: [], operations: 0, read: false, unread: false, edges: [] };
    features.push(entry);
    const path = join(outDir, 'chapters', `${id}.md`);
    if (!existsSync(path)) {
      entry.rows.push(`UNREAD\t${id}\tno chapter`);
      entry.unread = true;
      continue;
    }
    const parts = featureParts(readFileSync(path, 'utf-8'), ui.strings);
    if (parts.hasSection) {
      entry.read = true;
      for (const operation of parts.operations) entry.rows.push(`OP\t${id}\t${id}.md:${operation.line}\t${operation.title}`);
      entry.operations = parts.operations.length;
    } else {
      entry.rows.push(`UNREAD\t${id}\tno operations section`);
      entry.unread = true;
    }
    for (const handover of parts.handovers) {
      for (const other of handover.features.filter((feature) => feature !== id && ids.has(feature))) entry.edges.push({ other, line: `${id}.md:${handover.line}` });
    }
  }
  return features;
}

/**
 * Returns { status, lines }; status 1 with a message when map.json or the fixed text is missing, or `part` is not a part id.
 * With `part` (a part id of `processes parts`) only the part's features, the features linked to them by an EDGE, the edges
 * touching the part and the hand-overs of the part's domain are printed, and the counts cover what was printed.
 */
export function processesFacts(outDirArg, part = null) {
  const outDir = resolve(outDirArg);
  const map = readMapOrNull(outDir);
  if (map === null) return { status: 1, lines: ['map.json is missing or has no features; write and check the map first'] };
  const ui = loadUi(outDir);
  if (!ui.ok) return { status: 1, lines: ui.lines };
  let scope = null;
  if (part !== null) {
    const found = findPart(outDir, part);
    if (!found.ok) return { status: 1, lines: found.lines };
    scope = found.part;
  }
  const own = scope === null ? null : new Set(scope.features);
  const linked = own === null ? null : new Set(own);
  const features = collect(outDir, map, ui);
  if (own !== null) {
    for (const feature of features) {
      for (const { other } of feature.edges) {
        if (own.has(feature.id)) linked.add(other);
        if (own.has(other)) linked.add(feature.id);
      }
    }
  }
  const lines = [];
  let operations = 0;
  let read = 0;
  let unread = 0;
  let edges = 0;
  for (const feature of features) {
    if (linked === null || linked.has(feature.id)) {
      lines.push(...feature.rows);
      operations += feature.operations;
      if (feature.read) read += 1;
      if (feature.unread) unread += 1;
    }
    for (const { other, line } of feature.edges) {
      if (own !== null && !own.has(feature.id) && !own.has(other)) continue;
      lines.push(`EDGE\t${feature.id}\t${other}\t${line}`);
      edges += 1;
    }
  }
  const domains = readJson(join(outDir, 'domains.json'));
  let handovers = domains.ok && Array.isArray(domains.value?.handovers) ? domains.value.handovers : [];
  if (!domains.ok && !domains.missing) lines.push(`NOTE\tdomains.json ${domains.reason}`);
  if (scope !== null) handovers = handovers.filter((item) => item.from === scope.name || item.to === scope.name);
  for (const item of handovers) lines.push(`HANDOVER\t${item.from} -> ${item.to}: ${item.what}`);
  lines.push(`Counts: ${operations} operations in ${read} features, ${unread} features unread, ${edges} edges, ${handovers.length} domain hand-overs${scope === null ? '' : `, in part ${scope.id}`}`);
  return { status: 0, lines };
}
