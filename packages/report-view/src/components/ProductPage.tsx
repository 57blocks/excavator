import type { ReactNode } from 'react';

import type { ManifestProduct } from '../data/manifest';
import type { PayloadReader } from '../data/payload';
import { useReady } from '../hooks/use-signals';
import { useLoaded, useProduct, useViewer } from '../state/viewer';
import { Card } from './ui/Card';
import { Page } from './ui/Page';
import { RevisionBanner, unavailableCard } from './ui/ProductCards';

/** The card a page shows when its data could not be unpacked. */
export function LoadError({ title, error }: { title: string; error: Error }) {
  return (
    <Card title={title} tone="error">
      <p>{error.message}</p>
    </Card>
  );
}

/**
 * The frame of a page that shows one product: the heading, then the card for a
 * product that is not run or unreadable, or else the revision banner and the
 * content once `load` has its data. The page signals ready when it shows either.
 */
export function ProductPage<T>({ product: name, title, subtitle, load, children }: {
  product: string;
  title: string;
  subtitle: string;
  load: (payloads: PayloadReader, product: ManifestProduct) => Promise<T>;
  children: (data: T, product: ManifestProduct) => ReactNode;
}) {
  const { manifest, payloads } = useViewer();
  const product = useProduct(name);
  const unavailable = unavailableCard(product);
  const loaded = useLoaded(unavailable ? '' : name, () => (unavailable ? Promise.resolve(null as T) : load(payloads, product)));
  useReady(unavailable ? 'ready' : loaded.state);
  return (
    <Page title={title} subtitle={subtitle}>
      {unavailable}
      {unavailable ? null : <RevisionBanner manifest={manifest} product={product} />}
      {!unavailable && loaded.state === 'error' ? <LoadError title={`${product.label} could not be read`} error={loaded.error} /> : null}
      {!unavailable && loaded.state === 'ready' ? children(loaded.value, product) : null}
    </Page>
  );
}
