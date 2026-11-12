/**
 * Escape in a product view (openspec: changes/explorer-products, design D4): the
 * chosen row is cleared first, then the view closes. Returns whether it did
 * either, so the page's Escape order can go on to the next step when it did not.
 */
export function escapeProductView(state: {
  productView: unknown | null;
  productRow: unknown | null;
  setProductRow: (row: null) => void;
  closeProductView: () => void;
}): boolean {
  if (state.productRow !== null) {
    state.setProductRow(null);
    return true;
  }
  if (state.productView !== null) {
    state.closeProductView();
    return true;
  }
  return false;
}
