import { readInlineFile } from "../offline/inlineData";
import { PRODUCT_VIEWS, type ProductView } from "./productViews";

/**
 * Reads `products.json` (the packer's state for each product, openspec:
 * changes/explorer-products, design D1) and says each product's state in words.
 * The page never decides a state itself: it only reads what the packer wrote,
 * and anything it cannot read is a visible state with its reason.
 */

export type ProductStatus = "included" | "not-run" | "unreadable" | "different-revision";

export interface ProductState {
  status: ProductStatus;
  reason: string | null;
  /** The revision the product was made from. */
  revision: string | null;
  revisionNote: string | null;
  command: string | null;
}

export type ProductStates = Record<ProductView, ProductState>;

const STATUSES: ReadonlySet<string> = new Set<ProductStatus>(["included", "not-run", "unreadable", "different-revision"]);

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const unreadable = (reason: string): ProductState => ({ status: "unreadable", reason, revision: null, revisionNote: null, command: null });

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stateOf(name: string, item: unknown): ProductState {
  if (!isTable(item)) return unreadable(`products.json has no entry for ${name}`);
  const status = item.status;
  if (typeof status !== "string" || !STATUSES.has(status)) {
    return unreadable(`products.json gives ${name} the unknown status ${JSON.stringify(status)}`);
  }
  return {
    status: status as ProductStatus,
    reason: text(item.reason),
    revision: text(item.revision),
    revisionNote: text(item.revisionNote),
    command: text(item.command),
  };
}

/**
 * The state of each product in `products.json`; a product it does not hold, or a file that is not there, reads as unreadable with the reason.
 * `failure` is why the file could not be read at all (the reader's own error text), when there is one.
 */
export function readProductStates(products: unknown, failure?: string): ProductStates {
  const list = isTable(products) && Array.isArray(products.products) ? products.products : null;
  const states = {} as ProductStates;
  for (const def of PRODUCT_VIEWS) {
    if (list === null) {
      states[def.view] = unreadable(failure ?? "products.json is not in this page or is not in the expected shape");
      continue;
    }
    states[def.view] = stateOf(def.name, list.find((item) => isTable(item) && item.name === def.name));
  }
  return states;
}

/** The revision of the source packed into the page, as `products.json` records it; null when it does not. */
export function snapshotRevisionOf(products: unknown): string | null {
  return isTable(products) ? text(products.snapshotRevision) : null;
}

/** The lines a product's state is written as. */
export function describeProductState(state: ProductState, snapshotRevision: string | null): string[] {
  switch (state.status) {
    case "not-run":
      return [
        "Status: not run",
        ...(state.reason ? [`Reason: ${state.reason}`] : []),
        ...(state.command ? [`Command: ${state.command}`] : []),
      ];
    case "unreadable":
      return ["Status: unreadable", `Reason: ${state.reason ?? "not given"}`];
    case "different-revision":
      return [
        "Status: different revision",
        `Made from revision: ${state.revision ?? "not recorded"}`,
        `Packed source revision: ${snapshotRevision ?? "not recorded in this page"}`,
      ];
    case "included":
      return ["Status: included", `Revision: ${state.revision ?? state.revisionNote ?? "not recorded"}`];
  }
}

/**
 * The notice at the top of a view whose product was made from another revision than the source packed
 * into the page: both revisions, and that the content is shown as it is. Null for any other state.
 */
export function revisionNotice(state: ProductState, snapshotRevision: string | null): string | null {
  if (state.status !== "different-revision") return null;
  const made = state.revision ?? "not recorded";
  const packed = snapshotRevision ?? "not recorded in this page";
  return `This product was made from revision ${made}. The source packed into this page is at revision ${packed}. The content below is shown as the product holds it.`;
}

export interface LoadedProductStates {
  states: ProductStates;
  snapshotRevision: string | null;
}

/** The file's content, or the reason the page gives for not having it (a part that cannot be decoded says so, as it does for the product views). */
async function readJson(name: "products.json"): Promise<{ value?: unknown; failure?: string }> {
  try {
    const response = await readInlineFile(name);
    if (response.ok) return { value: await response.json() };
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    return { failure: typeof body?.error === "string" ? body.error : undefined };
  } catch (error) {
    return { failure: `${name} could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Reads `products.json` from the page data. */
export async function loadProductStates(): Promise<LoadedProductStates> {
  const { value, failure } = await readJson("products.json");
  return { states: readProductStates(value, failure), snapshotRevision: snapshotRevisionOf(value) };
}
