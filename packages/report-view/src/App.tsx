import { useEffect } from 'react';

import type { Manifest } from './data/manifest';
import { setCount, setReady } from './ready';

/** Signal readiness on the frame after the first content is mounted, never waiting for anything else. */
function useReadyAfterMount(state: '1' | 'error', counts: Record<string, number> = {}) {
  useEffect(() => {
    for (const [name, value] of Object.entries(counts)) setCount(name, value);
    const frame = requestAnimationFrame(() => setReady(state));
    return () => cancelAnimationFrame(frame);
    // Runs once per mount: the counts are fixed for a drawn page.
  }, []);
}

/** The shell: the project, its snapshot and the state of each product. The views come in later commits. */
export function App({ manifest }: { manifest: Manifest }) {
  useReadyAfterMount('1', { products: manifest.products.length });
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{manifest.project.name}</h1>
      <p className="mt-1 font-mono text-sm text-neutral-500">{manifest.snapshot.revision}</p>
      <ul className="mt-6 divide-y divide-neutral-200 rounded-xl border border-neutral-200">
        {manifest.products.map((product) => (
          <li key={product.name} className="flex justify-between px-4 py-3">
            <span>{product.label}</span>
            <span className="font-mono text-sm">{product.status}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** What the page shows when it cannot be drawn. */
export function ErrorCard({ title, error }: { title: string; error: unknown }) {
  useReadyAfterMount('error');
  return (
    <section className="m-8 rounded-xl border border-red-300 p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2">{error instanceof Error ? error.message : String(error)}</p>
    </section>
  );
}
