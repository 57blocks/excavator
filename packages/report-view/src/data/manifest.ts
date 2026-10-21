/**
 * The manifest the packer writes into `<script type="application/json"
 * id="xv-manifest">` (openspec: changes/viewer-app, design D3; the shape is the
 * one skills/excavator-view/pack.mjs builds). Product statuses and source
 * classes come from here as they are; the page never recomputes them.
 */

export const MANIFEST_ELEMENT_ID = 'xv-manifest';

export type ProductStatus = 'included' | 'not-run' | 'unreadable' | 'different-revision';

export interface ReportItem {
  name: string;
  label: string;
  file: string;
  status: 'included' | 'not-run';
  command: string;
  payload: string | null;
}

export interface ManifestProduct {
  name: string;
  label: string;
  status: ProductStatus;
  reason: string | null;
  revision: string | null;
  revisionNote: string | null;
  command: string;
  file: string;
  /** Ids of the data payloads the page holds for this product. */
  payloads: string[];
  /** Only on the `reports` entry. */
  items?: ReportItem[];
}

export type SourceBucket = 'embedded' | 'binary' | 'tooLarge' | 'notInSnapshot' | 'notEmbeddedOnRequest';

export interface SourceFileRow {
  bucket: SourceBucket;
  bytes?: number;
}

export interface SourceManifest {
  embedded: boolean;
  requested: boolean;
  limitBytes: number;
  counts: Record<SourceBucket, number>;
  files: Record<string, SourceFileRow>;
}

export interface Manifest {
  viewer: number;
  project: { name: string };
  snapshot: { revision: string; kind: string };
  products: ManifestProduct[];
  source: SourceManifest;
}

/** What the page needs of a document: an element by id. */
export interface ElementSource {
  getElementById(id: string): { textContent: string | null } | null;
}

/** Parse the manifest text; throws a readable error when it is not a manifest. */
export function parseManifest(text: string): Manifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`the manifest is not valid JSON: ${(error as Error).message}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('the manifest is not a JSON object');
  }
  const manifest = value as Partial<Manifest>;
  if (!Array.isArray(manifest.products)) throw new Error('the manifest has no products list');
  if (!manifest.project || typeof manifest.project.name !== 'string') throw new Error('the manifest has no project name');
  if (!manifest.snapshot || typeof manifest.snapshot.revision !== 'string') throw new Error('the manifest has no snapshot revision');
  return manifest as Manifest;
}

/** The manifest of the page `doc` holds. */
export function readManifest(doc: ElementSource): Manifest {
  const element = doc.getElementById(MANIFEST_ELEMENT_ID);
  if (!element) throw new Error(`the page has no manifest (#${MANIFEST_ELEMENT_ID})`);
  return parseManifest(element.textContent ?? '');
}

/** The manifest entry of product `name`, or undefined when the manifest does not list it. */
export function findProduct(manifest: Manifest, name: string): ManifestProduct | undefined {
  return manifest.products.find((product) => product.name === name);
}
