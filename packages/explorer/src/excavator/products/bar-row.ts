/**
 * One row of a bar list, as the product charts build it. Copied from the report
 * view's `BarRow` interface (openspec: changes/explorer-products, design D3);
 * only the type, not the report view's component that draws it.
 */
export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** The bar's colour (a CSS colour or var()); the accent by default. */
  colour?: string;
}
