/**
 * The three product overlays of the graph (openspec: changes/viewer-app, design
 * D8; spec "Product overlays"): which products they draw from, and how the ones
 * that are on are written in the address (`overlay=hotspots,unused`).
 */

import type { ProductName } from './product-facts';

export const OVERLAY_NAMES = ['hotspots', 'unused', 'doc-map'] as const;
export type OverlayName = (typeof OVERLAY_NAMES)[number];

/** The product each overlay reads, and the words the toggle and the legend use for it. */
export const OVERLAYS: Record<OverlayName, { product: ProductName; label: string }> = {
  hotspots: { product: 'hotspots', label: 'Hotspots' },
  unused: { product: 'unused-code', label: 'Unused' },
  'doc-map': { product: 'doc-map', label: 'Doc map' },
};

/** The overlays a parameter names, in the fixed order and each once; a name that is no overlay is ignored. */
export function parseOverlays(text: string | null | undefined): OverlayName[] {
  const named = new Set((text ?? '').split(','));
  return OVERLAY_NAMES.filter((name) => named.has(name));
}

/** The parameter for `overlays`; null when none is on. */
export function overlayParam(overlays: readonly OverlayName[]): string | null {
  const on = OVERLAY_NAMES.filter((name) => overlays.includes(name));
  return on.length === 0 ? null : on.join(',');
}

/** `overlays` with `name` turned on or off. */
export function toggleOverlay(overlays: readonly OverlayName[], name: OverlayName, on: boolean): OverlayName[] {
  return OVERLAY_NAMES.filter((candidate) => (candidate === name ? on : overlays.includes(candidate)));
}
