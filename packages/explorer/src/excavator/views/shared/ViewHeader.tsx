import { shortRevision } from "../../products/format";
import type { ProductState, ProductStatus } from "../../productStates";
import type { ProductViewDef } from "../../productViews";
import { Badge, type BadgeTone } from "./Controls";

const STATUS_LABEL: Record<ProductStatus, string> = {
  included: "included",
  "not-run": "not run",
  unreadable: "unreadable",
  "different-revision": "different revision",
};

const STATUS_TONE: Record<ProductStatus, BadgeTone> = { included: "good", "not-run": "neutral", unreadable: "bad", "different-revision": "warn" };

/** The heading of a product view: the serif title, the one-sentence subtitle, and the product's state and revision. */
export function ViewHeader({ def, state }: { def: ProductViewDef; state: ProductState | null }) {
  const revision = state?.revision ?? state?.revisionNote ?? null;
  return (
    <header className="space-y-2" data-excavator-view-header="">
      <h2 className="font-heading text-2xl tracking-wide text-text-primary">{def.title}</h2>
      <p className="max-w-3xl text-sm leading-relaxed text-text-secondary">{def.subtitle}</p>
      {state === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[state.status]}>{STATUS_LABEL[state.status]}</Badge>
          {revision === null ? null : (
            <span className="font-mono text-[11px] text-text-muted" title={revision} data-excavator-product-revision="">
              {`Revision ${shortRevision(revision)}`}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
