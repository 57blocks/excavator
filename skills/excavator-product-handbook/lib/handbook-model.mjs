/**
 * What `assemble` and `page` write from, besides the loaded run: the two
 * cross-cutting tables (summary.mjs), the system facts (system-facts.mjs), the
 * entities and relations (entities.mjs) and, for the technical view, the source
 * positions of each item (locations.mjs). Both outputs build it here, so they
 * cannot differ, and the project is scanned once.
 */

import { scanProject } from './applications.mjs';
import { buildEntities } from './entities.mjs';
import { buildLocations } from './locations.mjs';
import { buildSummary } from './summary.mjs';
import { buildSystem } from './system-facts.mjs';

/** `{ summary, system, entities, locations }`; `locations` is null unless `views` holds `technical`. */
export function handbookModel(run, root, views) {
  const scan = scanProject(root);
  const summary = buildSummary(run, root);
  const system = buildSystem(run, root, scan);
  const entities = buildEntities({ map: run.map, domains: run.domains, entries: run.entries, candidates: run.candidates, summary, system, scan });
  return { summary, system, entities, locations: views.includes('technical') ? buildLocations(run, root) : null };
}
