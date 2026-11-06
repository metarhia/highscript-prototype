'use strict';

const fail = (code, message) => Object.assign(new Error(message), { code });

// Refund amount is in payment currency; the gateway is charged in
// settlement currency, proportionally, so partial refunds add up exactly.
const settlementPart = (payment, refundedMinor) =>
  Math.round(
    (refundedMinor * payment.settlementAmountMinor) / payment.amountMinor,
  );

const create =
  ({ payments, gateway, logger }) =>
  async ({ paymentId, amountMinor, idempotencyKey }) => {
    const payment = await payments.findById(paymentId);
    if (!payment) {
      throw fail('PAYMENT_NOT_FOUND', `Payment ${paymentId} not found`);
    }
    if (await payments.findRequest(paymentId, idempotencyKey)) return payment;
    if (payment.status !== 'confirmed') {
      throw fail('INVALID_STATE', `Payment is ${payment.status}`);
    }
    const remaining = payment.amountMinor - payment.refundedMinor;
    if (amountMinor > remaining) {
      throw fail(
        'INVALID_INPUT',
        `Refund exceeds remaining amount ${remaining}`,
      );
    }
    const before = settlementPart(payment, payment.refundedMinor);
    const after = settlementPart(payment, payment.refundedMinor + amountMinor);
    await gateway.refund({
      gatewayPaymentId: payment.gatewayPaymentId,
      amountMinor: after - before,
      idempotencyKey,
    });
    const result = await payments.transition(paymentId, (current) => {
      const refundedMinor = current.refundedMinor + amountMinor;
      if (
        current.status !== 'confirmed' ||
        refundedMinor > current.amountMinor
      ) {
        return null;
      }
      const status =
        refundedMinor === current.amountMinor ? 'refunded' : 'confirmed';
      return {
        changes: { status, refundedMinor },
        kind: 'refund',
        amountMinor,
        idempotencyKey,
      };
    });
    if (result.applied) {
      logger.info(`payment ${paymentId} refunded ${amountMinor}`);
    }
    return result.payment;
  };

module.exports = { create };
