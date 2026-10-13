/**
 * errors.mjs
 *
 * Named failures of the view bake. Every one of them aborts the bake before
 * the output path is touched (an existing view.html stays byte-identical).
 * A truncated or malformed knowledge graph fails with the graph store's own
 * `KnowledgeGraphFormatError` instead, so the same defect has one name
 * everywhere.
 */

export class ViewBakeError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ViewBakeError';
  }
}

/** A required artifact (knowledge graph, source manifest) is absent or unreadable. */
export class MissingArtifactError extends ViewBakeError {
  /** @param {string} artifact @param {string} detail */
  constructor(artifact, detail) {
    super(`${artifact}: ${detail}; run /excavator first`);
    this.name = 'MissingArtifactError';
    this.artifact = artifact;
  }
}

/** The embedded data would exceed the hard size limit. */
export class ViewTooLargeError extends ViewBakeError {
  /** @param {{ product: string, requiredBytes: number, limitBytes: number }} args */
  constructor({ product, requiredBytes, limitBytes }) {
    super(`${product} needs ${requiredBytes} bytes of embedded data, above the hard limit of ${limitBytes} bytes; nothing was written`);
    this.name = 'ViewTooLargeError';
    this.product = product;
    this.requiredBytes = requiredBytes;
    this.limitBytes = limitBytes;
  }
}

/** The page template is missing or is not a valid view template. */
export class ViewTemplateError extends ViewBakeError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ViewTemplateError';
  }
}

/** The pre-write self-check (decode, counts, external references, CSP) failed. */
export class ViewSelfCheckError extends ViewBakeError {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`view self-check failed: ${problems.join('; ')}`);
    this.name = 'ViewSelfCheckError';
    this.problems = problems;
  }
}
