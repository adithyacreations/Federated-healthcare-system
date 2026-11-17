export const equipmentReturnDeadline = (order) => {
  const value = order.return_deadline;
  if (value) return new Date(value).getTime();
  const delivered = order.delivered_at || order.installed_at;
  return delivered ? new Date(delivered).getTime() + 7 * 24 * 60 * 60 * 1000 : null;
};

export const canRefundEquipmentOrder = (order, now = Date.now()) => {
  if (order.payment_status !== 'paid' || ['pending', 'processed', 'failed'].includes(order.refund_status)) return false;
  if (order.order_status === 'cancelled') return true;
  const deadline = equipmentReturnDeadline(order);
  return ['delivered', 'wrong_product'].includes(order.order_status) && deadline !== null && now < deadline;
};
