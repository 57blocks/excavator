import { readInlineFile } from "../offline/inlineData";

/**
 * Reads `products.json` (the packer's state for each product, openspec:
 * changes/explorer-products, design D1) and says each product's state in words.
 * The page never decides a state itself: it only reads what the packer wrote,
 * and anything it cannot read is a visible state with its reason.
 */

export type ProductStatus = "included" | "not-run" | "unreadable" | "different-revision";

/** The relations graph's coverage report: whether the page holds it, and why not (relations.mjs of the packer). */
export interface CoverageState {
  state: string;
  reason: string | null;
}

export interface ProductState {
  status: ProductStatus;
  reason: string | null;
  /** The revision the product was made from. */
  revision: string | null;
  revisionNote: string | null;
  command: string | null;
  /** Only the relations product has one; null for the others and when products.json gives none. */
  coverage: CoverageState | null;
}

const STATUSES: ReadonlySet<string> = new Set<ProductStatus>(["included", "not-run", "unreadable", "different-revision"]);

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const unreadable = (reason: string): ProductState => ({ status: "unreadable", reason, revision: null, revisionNote: null, command: null, coverage: null });

function coverageOf(value: unknown): CoverageState | null {
  if (!isTable(value) || typeof value.state !== "string") return null;
  return { state: value.state, reason: text(value.reason) };
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The state one `products.json`-shaped entry gives product `name`; an entry that is missing or has an unknown status reads as unreadable with the reason. */
export function productStateOf(name: string, item: unknown): ProductState {
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
    coverage: coverageOf(item.coverage),
  };
}

/**
 * The state `products.json` gives product `name`; a file that is not there, or an entry it does not hold, reads as
 * unreadable with the reason. `failure` is why the file could not be read at all, when there is one.
 */
export function productStateFromJson(products: unknown, name: string, failure?: string): ProductState {
  const list = isTable(products) && Array.isArray(products.products) ? products.products : null;
  if (list === null) return unreadable(failure ?? "products.json is not in this page or is not in the expected shape");
  return productStateOf(name, list.find((item) => isTable(item) && item.name === name));
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

/** The file's content, or the reason the page gives for not having it (a part that cannot be decoded says so, as it does for the product views). */
export async function readJson(name: "products.json"): Promise<{ value?: unknown; failure?: string }> {
  try {
    const response = await readInlineFile(name);
    if (response.ok) return { value: await response.json() };
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    return { failure: typeof body?.error === "string" ? body.error : undefined };
  } catch (error) {
    return { failure: `${name} could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}
