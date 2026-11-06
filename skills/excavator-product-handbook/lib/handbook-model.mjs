/**
 * What `assemble` and `page` write from, besides the loaded run: the two
 * cross-cutting tables (summary.mjs), the system facts (system-facts.mjs), the
 * entities and relations (entities.mjs) and, for the technical view, the source
 * positions of each item (locations.mjs), the data section and the status dictionary. Both outputs build it here, so they
 * cannot differ, and the project is scanned once. The verified findings of the features
 * (findings-model.mjs) are part of it too, each group with its priority (priority-model.mjs), and the remedies resolved against the facts of those findings (remedies-model.mjs).
 */

import { scanProject } from './applications.mjs';
import { buildEntities } from './entities.mjs';
import { buildFindings } from './findings-model.mjs';
import { loadDataSection } from './data-section.mjs';
import { loadDictionariesSection } from './dict-section.mjs';
import { buildLocations } from './locations.mjs';
import { withPriority } from './priority-model.mjs';
import { factsOf } from './remedies-facts.mjs';
import { withRemedies } from './remedies-model.mjs';
import { buildSummary } from './summary.mjs';
import { buildSystem } from './system-facts.mjs';

/** `{ summary, system, entities, locations, data, dictionaries, findings, remedies }`; `remedies` is remedies-model.mjs's; `findings` is `{ list, groups, locations, applications, priority }` (findings-model.mjs, priority-model.mjs), its `locations` null unless `views` holds `technical`; `locations`, `data` (the data section, data-section.mjs) and `dictionaries` (the status dictionary, dict-section.mjs) are null unless `views` holds `technical`. */
export function handbookModel(run, root, views) {
  const scan = scanProject(root);
  const summary = buildSummary(run, root);
  const system = buildSystem(run, root, scan);
  const entities = buildEntities({ map: run.map, domains: run.domains, entries: run.entries, candidates: run.candidates, summary, system, scan });
  const technical = views.includes('technical');
  const findings = withPriority(buildFindings(run, root, { technical, roots: scan.roots, applicationRows: system.applications }), run.priority);
  // The data section is read once: the technical view shows it, and the remedies' facts count the tables that several applications mention.
  const dataSection = loadDataSection(run.outDir);
  const remedies = withRemedies(run.remedies, factsOf({ findings, applications: system.applications, data: dataSection }));
  return { summary, system, entities, findings, remedies, locations: technical ? buildLocations(run, root) : null, data: technical ? dataSection : null, dictionaries: technical ? loadDictionariesSection(run.outDir) : null };
}
