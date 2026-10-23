/**
 * The words the page uses for a product's state, and the state the Products page
 * shows for a product (report-viewer: included, not run, unreadable, different
 * revision). The states themselves are the packer's; nothing here decides one.
 */

import type { ManifestProduct, ProductStatus } from '../data/manifest';

const STATUS_LABELS: Record<ProductStatus, string> = {
  included: 'Included',
  'not-run': 'Not run',
  unreadable: 'Unreadable',
  'different-revision': 'Different revision',
};

export function statusLabel(status: string): string {
  return Object.hasOwn(STATUS_LABELS, status) ? STATUS_LABELS[status as ProductStatus] : status;
}

const SEVERITY: Record<string, number> = { unreadable: 3, 'different-revision': 2, 'not-run': 1, included: 0 };

/** The most serious state among the products: unreadable, different revision, not run, included. */
export function worstStatus(products: readonly { status: string }[]): ProductStatus {
  let worst: ProductStatus = 'included';
  for (const product of products) {
    if ((SEVERITY[product.status] ?? 0) > SEVERITY[worst]) worst = product.status as ProductStatus;
  }
  return worst;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Products whose content the page withholds when it is a different revision: a tour's node ids name one exact fact graph. */
const WITHHELD_WHEN_DIFFERENT: Readonly<Record<string, string>> = {
  tour: 'Its steps are not shown: their node ids may not match this graph.',
};

/** What the page says about the content of product `name` when it is a different revision. */
export function differentRevisionNote(name: string): string {
  return Object.hasOwn(WITHHELD_WHEN_DIFFERENT, name) ? WITHHELD_WHEN_DIFFERENT[name] : 'Its content is shown as it was written.';
}

/** What the Products page says in a product's detail cell. */
export function detailText(product: Pick<ManifestProduct, 'status' | 'reason' | 'file' | 'revision' | 'revisionNote'> & { name?: string }, snapshotRevision: string): string {
  if (product.status === 'unreadable') return product.reason || 'The file could not be read.';
  if (product.status === 'not-run') return `There is no ${product.file}.`;
  if (product.status === 'different-revision') {
    // A product made at the snapshot's revision from other facts (the domain graph) has only its reason to give.
    const parts = [
      ...(product.revision !== snapshotRevision || !product.reason ? [`Made at ${product.revision}; the source snapshot is ${snapshotRevision}.`] : []),
      ...(product.reason ? [`${product.reason}.`] : []),
      ...(product.name !== undefined && Object.hasOwn(WITHHELD_WHEN_DIFFERENT, product.name) ? [WITHHELD_WHEN_DIFFERENT[product.name]] : []),
    ];
    return parts.join(' ');
  }
  if (product.revisionNote) return `${capitalize(product.revisionNote)}.`;
  return 'Made at the source snapshot revision.';
}
