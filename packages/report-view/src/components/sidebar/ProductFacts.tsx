import { findProduct } from '../../data/manifest';
import type { GraphNode } from '../../data/graph';
import { nodeProductFacts, productsFor, type ProductFact, type ProductName, type ProductSource } from '../../lib/product-facts';
import { useLoaded, useViewer } from '../../state/viewer';
import { Facts } from '../ui/Controls';

/** The products that speak about `node`'s kind of node, each with its data once unpacked. */
function useProductSources(names: readonly ProductName[]) {
  const { manifest, payloads } = useViewer();
  return useLoaded(names.join(','), async () => {
    const sources: Partial<Record<ProductName, ProductSource>> = {};
    for (const name of names) {
      const product = findProduct(manifest, name);
      if (!product) continue;
      const usable = product.status === 'included' || product.status === 'different-revision';
      sources[name] = { product, data: usable ? await payloads.parsed<Record<string, any>>(product.payloads[0]) : null };
    }
    return sources;
  });
}

function FactBlock({ fact }: { fact: ProductFact }) {
  return (
    <div data-xv-product-fact={fact.name} data-xv-fact-state={fact.state}>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{fact.label}</h4>
      {fact.state === 'facts' ? (
        <>
          <Facts items={fact.rows.map((row) => [row.label, row.value] as const)} />
          {fact.note ? <p className="mt-1 text-xs text-muted">{fact.note}</p> : null}
        </>
      ) : (
        <>
          <p className="m-0">{fact.text}</p>
          {fact.state === 'not-run' ? <p className="mt-1">Command: <code>{fact.command}</code></p> : null}
        </>
      )}
    </div>
  );
}

/** What the products say about the node: a file's hotspots and doc-map facts, a function's unused-code facts. */
export function ProductFacts({ node }: { node: GraphNode }) {
  const names = productsFor(node);
  const loaded = useProductSources(names);
  if (names.length === 0) return null;
  return (
    <section aria-label="Product facts" className="flex flex-col gap-3">
      <h3>Product facts</h3>
      {loaded.state === 'loading' ? <p className="text-muted">Reading the products.</p> : null}
      {loaded.state === 'error' ? <p className="text-muted">{`A product could not be read: ${loaded.error.message}`}</p> : null}
      {loaded.state === 'ready' ? nodeProductFacts(node, loaded.value).map((fact) => <FactBlock key={fact.name} fact={fact} />) : null}
    </section>
  );
}
