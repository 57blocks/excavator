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
import { loadUi } from './ui.mjs';

/** Returns { status, lines }; status 1 with a message when map.json or the fixed text is missing. */
export function processesFacts(outDirArg) {
  const outDir = resolve(outDirArg);
  const map = readMapOrNull(outDir);
  if (map === null) return { status: 1, lines: ['map.json is missing or has no features; write and check the map first'] };
  const ui = loadUi(outDir);
  if (!ui.ok) return { status: 1, lines: ui.lines };
  const ids = new Set(map.features.map((feature) => feature.id));
  const lines = [];
  let operations = 0;
  let read = 0;
  let unread = 0;
  let edges = 0;
  for (const { id } of map.features) {
    const path = join(outDir, 'chapters', `${id}.md`);
    if (!existsSync(path)) {
      lines.push(`UNREAD\t${id}\tno chapter`);
      unread += 1;
      continue;
    }
    const parts = featureParts(readFileSync(path, 'utf-8'), ui.strings);
    if (parts.hasSection) {
      read += 1;
      for (const operation of parts.operations) lines.push(`OP\t${id}\t${id}.md:${operation.line}\t${operation.title}`);
      operations += parts.operations.length;
    } else {
      lines.push(`UNREAD\t${id}\tno operations section`);
      unread += 1;
    }
    for (const handover of parts.handovers) {
      for (const other of handover.features.filter((feature) => feature !== id && ids.has(feature))) {
        lines.push(`EDGE\t${id}\t${other}\t${id}.md:${handover.line}`);
        edges += 1;
      }
    }
  }
  const domains = readJson(join(outDir, 'domains.json'));
  const handovers = domains.ok && Array.isArray(domains.value?.handovers) ? domains.value.handovers : [];
  if (!domains.ok && !domains.missing) lines.push(`NOTE\tdomains.json ${domains.reason}`);
  for (const item of handovers) lines.push(`HANDOVER\t${item.from} -> ${item.to}: ${item.what}`);
  lines.push(`Counts: ${operations} operations in ${read} features, ${unread} features unread, ${edges} edges, ${handovers.length} domain hand-overs`);
  return { status: 0, lines };
}
