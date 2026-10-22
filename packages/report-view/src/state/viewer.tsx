import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { findProduct, type Manifest, type ManifestProduct } from '../data/manifest';
import type { PayloadReader } from '../data/payload';

interface Viewer {
  manifest: Manifest;
  payloads: PayloadReader;
}

const ViewerContext = createContext<Viewer | null>(null);

export function ViewerProvider({ manifest, payloads, children }: Viewer & { children: ReactNode }) {
  return <ViewerContext.Provider value={{ manifest, payloads }}>{children}</ViewerContext.Provider>;
}

export function useViewer(): Viewer {
  const viewer = useContext(ViewerContext);
  if (!viewer) throw new Error('useViewer was used outside a ViewerProvider');
  return viewer;
}

/** The manifest entry of a product the packer is known to write; a manifest without it is a page that cannot be drawn. */
export function useProduct(name: string): ManifestProduct {
  const product = findProduct(useViewer().manifest, name);
  if (!product) throw new Error(`the manifest has no "${name}" product`);
  return product;
}

export type Loaded<T> = { state: 'loading' } | { state: 'error'; error: Error } | { state: 'ready'; value: T };

/** Run `load` when `key` changes; the result is loading, an error to show, or the value. */
export function useLoaded<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [result, setResult] = useState<{ key: string; loaded: Loaded<T> } | null>(null);
  useEffect(() => {
    let current = true;
    load().then(
      (value) => current && setResult({ key, loaded: { state: 'ready', value } }),
      (error: unknown) => current && setResult({ key, loaded: { state: 'error', error: error instanceof Error ? error : new Error(String(error)) } }),
    );
    return () => {
      current = false;
    };
    // `load` is a closure over what `key` names.
  }, [key]);
  return result !== null && result.key === key ? result.loaded : { state: 'loading' };
}

/** The parsed JSON of a payload the page holds. */
export function useJsonPayload<T>(name: string): Loaded<T> {
  const { payloads } = useViewer();
  return useLoaded(name, () => payloads.parsed<T>(name));
}

/** The text of a payload the page holds. */
export function useTextPayload(name: string): Loaded<string> {
  const { payloads } = useViewer();
  return useLoaded(name, () => payloads.text(name));
}
