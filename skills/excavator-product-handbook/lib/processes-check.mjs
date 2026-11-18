/**
 * `check processes`: what guards the business-processes chapter against an invented operation (openspec change
 * handbook-process-review, design D7). Every step names an operation in bold and the feature it belongs to as `(F<n>)`;
 * the operation, trimmed, must equal one level-3 heading of that feature chapter's operations section, which is read from
 * disk. A process with no numbered step is refused (its number `P<n>` would sit on an empty process). The chapter's own lint
 * (citations exist, code words, a cited fact) runs as for every chapter.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { featureParts, parseProcesses } from './processes-parse.mjs';

const quoted = (titles) => titles.map((title) => JSON.stringify(title)).join(', ');

/** The reasons the business-processes chapter `text` is refused. `featureIds`: the ids of map.json. */
export function processesReasons(outDir, text, { featureIds, strings }) {
  const reasons = [];
  const operations = new Map();
  const operationsOf = (id) => {
    if (!operations.has(id)) {
      const path = join(outDir, 'chapters', `${id}.md`);
      operations.set(id, existsSync(path) ? featureParts(readFileSync(path, 'utf-8'), strings) : null);
    }
    return operations.get(id);
  };
  for (const process of parseProcesses(text)) {
    if (process.steps.length === 0) reasons.push(`line ${process.line}: process ${JSON.stringify(process.name)} has no numbered step`);
    for (const step of process.steps) {
      if (step.operation === null) {
        reasons.push(`line ${step.line}: a step needs its operation in bold`);
        continue;
      }
      if (step.feature === null) {
        reasons.push(`line ${step.line}: a step needs the feature id of its operation, as (F<n>)`);
        continue;
      }
      if (!featureIds.includes(step.feature)) {
        reasons.push(`line ${step.line}: ${step.feature} is not a feature of the map`);
        continue;
      }
      const parts = operationsOf(step.feature);
      if (parts === null) reasons.push(`line ${step.line}: ${step.feature} has no chapter, so "${step.operation}" cannot be one of its operations`);
      else if (!parts.hasSection) reasons.push(`line ${step.line}: ${step.feature} has no operations section, so "${step.operation}" cannot be one of its operations`);
      else if (!parts.operations.some((operation) => operation.title === step.operation)) {
        reasons.push(`line ${step.line}: "${step.operation}" is not an operation of ${step.feature}; its operations are: ${parts.operations.length === 0 ? '(none)' : quoted(parts.operations.map((operation) => operation.title))}`);
      }
    }
  }
  return reasons;
}
