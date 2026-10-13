/**
 * inventory.mjs
 *
 * Which `.excavator/` artifacts a bake reads, which of them are required, and
 * what the page says when an optional one is missing (openspec change
 * `artifact-view`, design D6). The page renders from this inventory only; it
 * never guesses Lazy versus Full. `intermediate/` is never an input: a team
 * may commit only the final products.
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ARTIFACTS = Object.freeze([
  {
    name: 'knowledge-graph.jsonl', required: true,
    sections: ['overview', 'graph', 'coverage', 'search'],
    missing: 'run /excavator',
  },
  {
    name: 'source-manifest.json', required: true,
    sections: ['selection', 'members', 'revision'],
    missing: 'run /excavator',
  },
  {
    name: 'fingerprints.json', required: false,
    sections: ['structure'],
    missing: 'line counts unavailable; the structure treemap sizes files by count',
  },
  {
    name: 'source-index.jsonl', required: false,
    sections: ['search'],
    missing: 'identifier search unavailable',
  },
  {
    name: 'semantic-cache.json', required: false,
    sections: ['semantics'],
    missing: 'not generated: run /excavator --mode=full, or generate on demand in /excavator-chat',
  },
  {
    name: 'semantic-graph.json', required: false,
    sections: ['layers'],
    missing: 'not generated: run /excavator --mode=full',
  },
  {
    name: 'domain-graph.json', required: false,
    sections: ['domain'],
    missing: 'not generated: run /excavator-domain',
  },
]);

/**
 * @param {string} dataDir
 * @returns {Array<{ name: string, required: boolean, sections: string[], status: 'present'|'missing', bytes: number|null, missing: string }>}
 */
export function takeInventory(dataDir) {
  return ARTIFACTS.map((artifact) => {
    const path = join(dataDir, artifact.name);
    const present = existsSync(path) && statSync(path).isFile();
    return {
      name: artifact.name,
      required: artifact.required,
      sections: [...artifact.sections],
      status: present ? 'present' : 'missing',
      bytes: present ? statSync(path).size : null,
      missing: artifact.missing,
    };
  });
}
