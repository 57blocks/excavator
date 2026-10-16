/**
 * inventory-rules.mjs
 *
 * Which `.excavator/` artifacts a view reads, which of them are required, and
 * what the page says when an optional one is missing (openspec change
 * `artifact-view`, design D6). The page renders from this inventory only; it
 * never guesses Lazy versus Full. `intermediate/` is never an input: a team
 * may commit only the final products. Pure: the caller says which files
 * exist (the bake from the file system, the page from a dropped directory).
 */

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

/** The artifact names a view reads (top-level files of `.excavator/`). */
export const ARTIFACT_NAMES = Object.freeze(ARTIFACTS.map((a) => a.name));

/**
 * @param {(name: string) => number | null} sizeOf the file's byte size, or null when it is not a file in the directory
 * @returns {Array<{ name: string, required: boolean, sections: string[], status: 'present'|'missing'|'invalid', bytes: number|null, missing: string, reason?: string }>}
 */
export function inventoryOf(sizeOf) {
  return ARTIFACTS.map((artifact) => {
    const size = sizeOf(artifact.name);
    return {
      name: artifact.name,
      required: artifact.required,
      sections: [...artifact.sections],
      status: size === null ? 'missing' : 'present',
      bytes: size,
      missing: artifact.missing,
    };
  });
}
