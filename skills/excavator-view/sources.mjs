/**
 * sources.mjs
 *
 * The place where the pack collects the source files the products point at
 * (openspec: changes/report-viewer, design D4). This version of the viewer has
 * no Code page, so no source is embedded: every pack records that plainly in
 * the manifest instead of leaving the question open. The Code page change
 * replaces this function with the collection and classification of D4.
 */

/**
 * @param {{ noSource: boolean }} options
 * @returns {{ manifest: object, payloads: {id: string, bytes: Buffer}[] }}
 */
export function collectSources({ noSource }) {
  return {
    manifest: { embedded: false, requested: !noSource, files: 0 },
    payloads: [],
  };
}
