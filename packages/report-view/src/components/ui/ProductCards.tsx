import type { Manifest, ManifestProduct } from '../../data/manifest';
import { Card } from './Card';

/** The banner a product page shows at its top when the product was made at another revision; null otherwise. */
export function RevisionBanner({ manifest, product }: { manifest: Manifest; product: ManifestProduct | null | undefined }) {
  if (!product || product.status !== 'different-revision') return null;
  return (
    <Card title={`${product.label}: different revision`} tone="warn">
      <p>
        The product was made at <code>{product.revision}</code>; the source snapshot is <code>{manifest.snapshot.revision}</code>. Its content is shown as it was written.
      </p>
    </Card>
  );
}

/** The card a page shows instead of its content when its product is not run or cannot be read; null when it can be shown. */
export function unavailableCard(product: Pick<ManifestProduct, 'status' | 'label' | 'file' | 'command' | 'reason'>) {
  if (product.status === 'not-run') {
    return (
      <Card title={`${product.label}: not run`}>
        <p>There is no {product.file} in .excavator/.</p>
        <p>
          Command: <code>{product.command}</code>
        </p>
      </Card>
    );
  }
  if (product.status === 'unreadable') {
    return (
      <Card title={`${product.label}: unreadable`} tone="error">
        <p>{product.reason || 'The file could not be read.'}</p>
      </Card>
    );
  }
  return null;
}
