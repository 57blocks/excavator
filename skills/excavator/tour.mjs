#!/usr/bin/env node
/**
 * tour.mjs
 *
 * The deterministic halves of the learning tour (openspec: changes/tour-product,
 * capability `learning-tour`). No model, no build of the target. The host skill
 * writes the tour between the subcommands; the subcommands write only under
 * `.excavator/tour/` and, for `report`, `.excavator/tour.json`.
 *
 *   node tour.mjs candidates <projectRoot>
 *
 * `candidates` reads the knowledge graph, the semantic files and the domain graph
 * and writes `.excavator/tour/candidates.json`: the nodes a tour may cite, each with
 * its summary and the reasons it was picked (`tour-candidates.mjs`). It exits non-zero
 * when there is no knowledge graph.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { writeCandidates } from './tour-candidates.mjs';

const USAGE = 'Usage: node tour.mjs candidates <projectRoot>\n';

function candidatesCommand(root) {
  const { out, product } = writeCandidates(root);
  const classes = Object.fromEntries(Object.entries(product.classes).map(([name, { total, truncated }]) => [name, { total, truncated }]));
  process.stdout.write(`${JSON.stringify({ out, factsDigest: product.factsDigest, sourceRevision: product.sourceRevision, candidates: product.candidates.length, classes, gaps: product.gaps })}\n`);
  const cut = Object.entries(classes).map(([name, { total, truncated }]) => `${name} ${total}${truncated > 0 ? ` (${truncated} cut)` : ''}`).join(', ');
  process.stderr.write(`tour candidates: ${product.candidates.length} candidates; ${cut}\n`);
}

function main(argv) {
  const [command, root, ...rest] = argv;
  if (command === 'candidates' && root && rest.length === 0) return candidatesCommand(root);
  process.stderr.write(USAGE);
  process.exit(1);
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`tour.mjs failed: ${error.message}\n`);
    process.exit(1);
  }
}
