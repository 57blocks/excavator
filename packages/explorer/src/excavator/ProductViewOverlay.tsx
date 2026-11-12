import { useEffect, useState } from "react";
import { useDashboardStore } from "../store";
import { useIsMobile } from "../hooks/useIsMobile";
import { describeProductState, loadProductStates, revisionNotice, type LoadedProductStates } from "./productStates";
import { productViewDef, type ProductView } from "./productViews";
import InlineRowDetail from "./views/InlineRowDetail";
import { useProductFile } from "./views/productFiles";
import { VIEW_MODULES } from "./views/registry";
import { ViewErrorBoundary } from "./views/shared/ErrorBoundary";
import { Notice, Section } from "./views/shared/Section";
import { ViewHeader } from "./views/shared/ViewHeader";

/**
 * The product view laid over the graph area (openspec: changes/explorer-products,
 * design D2 and D3). Absolute and opaque so the graph under it stays mounted and keeps
 * its viewport and layout. A product that was not run or cannot be read shows only its
 * state; one made from another revision shows a notice naming both revisions above its
 * content. The content column is centred and the tables scroll inside their own boxes.
 */
export default function ProductViewOverlay() {
  const productView = useDashboardStore((s) => s.productView);
  const [loaded, setLoaded] = useState<LoadedProductStates | null>(null);

  useEffect(() => {
    let live = true;
    void loadProductStates().then((result) => {
      if (live) setLoaded(result);
    });
    return () => {
      live = false;
    };
  }, []);

  if (productView === null) return null;
  return (
    <div className="absolute inset-0 z-10 overflow-auto bg-root" data-excavator-product-view={productView}>
      <div className="mx-auto w-full max-w-[1100px] space-y-5 px-4 py-6 sm:px-6 animate-fade-slide-in">
        <ViewContent key={productView} view={productView} loaded={loaded} />
      </div>
    </div>
  );
}

function ViewContent({ view, loaded }: { view: ProductView; loaded: LoadedProductStates | null }) {
  const def = productViewDef(view);
  const module = VIEW_MODULES[view];
  const isMobile = useIsMobile();
  const state = loaded === null ? null : loaded.states[view];
  const hasContent = state !== null && (state.status === "included" || state.status === "different-revision");
  const primary = useProductFile(hasContent ? module.files[0] : null);
  const secondary = useProductFile(hasContent && module.files.length > 1 ? (module.files[1] as "doc-map-checks.json") : null);

  let body = null;
  if (state === null) {
    body = <p className="text-sm text-text-muted">Loading.</p>;
  } else if (!hasContent) {
    body = (
      <Section title="Product state">
        <ul className="m-0 list-none space-y-1 p-0 text-sm text-text-secondary" data-excavator-state="">
          {describeProductState(state, loaded?.snapshotRevision ?? null).map((line) => (
            <li key={line} className="[overflow-wrap:anywhere]">{line}</li>
          ))}
        </ul>
      </Section>
    );
  } else if (primary === null) {
    body = <p className="text-sm text-text-muted">Loading.</p>;
  } else if (primary.state === "missing") {
    body = (
      <Notice tone="error" title="The product file is not in this page" data-excavator-notice="error">
        {primary.reason}
      </Notice>
    );
  } else if (module.files.length > 1 && secondary === null) {
    body = <p className="text-sm text-text-muted">Loading.</p>;
  } else {
    const notice = revisionNotice(state, loaded?.snapshotRevision ?? null);
    body = (
      <>
        {notice === null ? null : (
          <Notice tone="warn" title="Different revision" data-excavator-notice="revision">
            {notice}
          </Notice>
        )}
        <ViewErrorBoundary>
          <module.Body primary={primary.value} secondary={secondary?.state === "ready" ? secondary.value : null} detail={isMobile ? <InlineRowDetail /> : null} />
        </ViewErrorBoundary>
      </>
    );
  }

  return (
    <>
      <ViewHeader def={def} state={state} />
      {body}
    </>
  );
}
