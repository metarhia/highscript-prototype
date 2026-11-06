'use strict';

const fail = (code, message) => Object.assign(new Error(message), { code });

const create =
  ({ payments, gateway, logger }) =>
  async ({ paymentId, idempotencyKey }) => {
    const payment = await payments.findById(paymentId);
    if (!payment) {
      throw fail('PAYMENT_NOT_FOUND', `Payment ${paymentId} not found`);
    }
    if (payment.status === 'cancelled') return payment;
    if (payment.status !== 'created') {
      throw fail('INVALID_STATE', `Payment is ${payment.status}`);
    }
    await gateway.cancel({
      gatewayPaymentId: payment.gatewayPaymentId,
      idempotencyKey,
    });
    const result = await payments.transition(paymentId, (current) => {
      if (current.status !== 'created') return null;
      return {
        changes: { status: 'cancelled' },
        kind: 'cancel',
        amountMinor: current.amountMinor,
      };
    });
    if (result.applied) logger.info(`payment ${paymentId} cancelled`);
    return result.payment;
  };

module.exports = { create };
