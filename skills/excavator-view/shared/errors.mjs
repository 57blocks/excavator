/**
 * errors.mjs
 *
 * Failures of the shared `.excavator/` readers that are not the knowledge
 * graph's own (`KnowledgeGraphFormatError`) or a missing required artifact
 * (`MissingArtifactError`, bake/errors.mjs). Pure: no `node:` import, so the
 * page imports it too.
 */

/** An optional artifact exists but cannot be read; its inventory entry becomes `invalid`. */
export class OptionalArtifactError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'OptionalArtifactError';
  }
}

/** @param {string} text */
export function parseArtifactJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new OptionalArtifactError(`not valid JSON (${/** @type {Error} */ (error).message})`);
  }
}
