'use strict';

const create =
  ({ payments }) =>
  async ({ paymentId }) => {
    const payment = await payments.findById(paymentId);
    if (!payment) {
      const error = new Error(`Payment ${paymentId} not found`);
      error.code = 'PAYMENT_NOT_FOUND';
      throw error;
    }
    return payment;
  };

module.exports = { create };
