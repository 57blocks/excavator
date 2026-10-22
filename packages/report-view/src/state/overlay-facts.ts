import { useMemo } from 'react';

import { findProduct } from '../data/manifest';
import type { GraphIndex } from '../data/indexes';
import { overlayAvailability, docMapFacts, hotspotsFacts, unusedFacts, type OverlayFacts } from '../lib/overlays';
import { OVERLAYS, type OverlayName } from '../lib/overlay-names';
import { useLoaded, useViewer, type Loaded } from './viewer';

type Json = Record<string, any>;

/** The data of the product behind `overlay`, unpacked while the overlay is on and its product is in the page. */
function useOverlayProduct(overlay: OverlayName, on: boolean): Loaded<Json | null> {
  const { manifest, payloads } = useViewer();
  const product = findProduct(manifest, OVERLAYS[overlay].product);
  const usable = on && overlayAvailability(product).enabled && product !== undefined;
  return useLoaded(usable ? overlay : '', () => (usable && product ? payloads.parsed<Json>(product.payloads[0]) : Promise.resolve(null)));
}

export interface OverlayData {
  /** What each overlay that is on can draw; an overlay that is off, not in the page or still being read is null. */
  facts: OverlayFacts;
  /** An overlay that is on is still being read. */
  pending: boolean;
  error: Error | null;
}

/**
 * The facts of the overlays that are on (see lib/overlays.ts). Each product is read on its own, so turning a second
 * overlay on does not take the first one's marks away while it loads.
 */
export function useOverlayFacts(index: GraphIndex, overlays: readonly OverlayName[]): OverlayData {
  const hot = useOverlayProduct('hotspots', overlays.includes('hotspots'));
  const unused = useOverlayProduct('unused', overlays.includes('unused'));
  const docMap = useOverlayProduct('doc-map', overlays.includes('doc-map'));
  const hotspotsOf = hot.state === 'ready' ? hot.value : null;
  const unusedOf = unused.state === 'ready' ? unused.value : null;
  const docMapOf = docMap.state === 'ready' ? docMap.value : null;
  const facts = useMemo<OverlayFacts>(
    () => ({
      hotspots: hotspotsOf ? hotspotsFacts(hotspotsOf) : null,
      unused: unusedOf ? unusedFacts(unusedOf, index) : null,
      docMap: docMapOf ? docMapFacts(docMapOf) : null,
    }),
    [hotspotsOf, unusedOf, docMapOf, index],
  );
  const wanted = (name: OverlayName, loaded: Loaded<Json | null>) => overlays.includes(name) && loaded.state === 'loading';
  const failed = [hot, unused, docMap].find((loaded) => loaded.state === 'error');
  return {
    facts,
    pending: wanted('hotspots', hot) || wanted('unused', unused) || wanted('doc-map', docMap),
    error: failed && failed.state === 'error' ? failed.error : null,
  };
}
