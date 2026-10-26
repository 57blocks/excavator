let lastId = 0;

function createOrder(input) {
  if (!input.customerId) {
    throw new Error('customer is required');
  }
  return { id: ++lastId, status: 'open', quantity: input.quantity };
}

function cancelOrder(order) {
  order.status = 'cancelled';
  return order;
}

function reopenOrder(order) {
  order.status = 'open';
  return order;
}

module.exports = { createOrder, cancelOrder, reopenOrder };
