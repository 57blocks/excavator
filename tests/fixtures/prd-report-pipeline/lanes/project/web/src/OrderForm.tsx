export function validateOrder(quantity: number): string | null {
  if (quantity < 1) {
    return 'Quantity must be at least 1';
  }
  return null;
}
