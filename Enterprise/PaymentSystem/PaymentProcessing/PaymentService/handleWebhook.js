'use strict';

// Reconciles payment state with gateway notifications. Events are
// deduplicated by eventId; transitions are applied only from valid states,
// so notifications that repeat our own changes are acknowledged as no-ops.

const decide = (current, status) => {
  if (current.status === status) return null;
  const { amountMinor } = current;
  if (current.status === 'created' && status === 'confirmed') {
    return { changes: { status }, kind: 'confirm', amountMinor };
  }
  if (current.status === 'created' && status === 'cancelled') {
    return { changes: { status }, kind: 'cancel', amountMinor };
  }
  if (current.status === 'confirmed' && status === 'refunded') {
    return {
      changes: { status, refundedMinor: amountMinor },
      kind: 'refund',
      amountMinor: amountMinor - current.refundedMinor,
    };
  }
  return null;
};

const create =
  ({ payments, logger }) =>
  async ({ eventId, gatewayPaymentId, status }) => {
    if (await payments.isEventKnown(eventId)) return { accepted: true };
    const payment = await payments.findByGatewayId(gatewayPaymentId);
    if (!payment) {
      logger.warn(
        `webhook ${eventId}: unknown gateway payment ${gatewayPaymentId}`,
      );
      return { accepted: false };
    }
    const { applied } = await payments.transition(
      payment.paymentId,
      (current) => decide(current, status),
    );
    await payments.registerEvent({
      eventId,
      gatewayPaymentId,
      status,
      applied,
    });
    if (applied) {
      logger.info(`payment ${payment.paymentId} ${status} by gateway`);
    }
    return { accepted: true };
  };

module.exports = { create };
