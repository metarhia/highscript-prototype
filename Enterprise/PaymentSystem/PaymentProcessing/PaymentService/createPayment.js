'use strict';

const fail = (code, message) => Object.assign(new Error(message), { code });

const sameRequest = (payment, data) =>
  payment.amountMinor === data.amountMinor &&
  payment.currency === data.currency;

const settle = async (exchange, settlement, { amountMinor, currency }) => {
  if (currency === settlement.currency) {
    return { amountMinor, currency, quoteId: null };
  }
  const quote = await exchange.quote({
    from: currency,
    to: settlement.currency,
    amountMinor,
  });
  return {
    amountMinor: quote.amountMinor,
    currency: quote.currency,
    quoteId: quote.quoteId,
  };
};

const create =
  ({ payments, gateway, exchange, normalize, settlement, logger }) =>
  async (input) => {
    const data = normalize(input);
    const { merchantId, idempotencyKey } = data;
    const existing = await payments.findByIdempotencyKey(
      merchantId,
      idempotencyKey,
    );
    if (existing) {
      if (sameRequest(existing, data)) return existing;
      throw fail(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was used for another payment',
      );
    }
    const settled = await settle(exchange, settlement, data);
    const paymentId = payments.newId();
    const receipt = await gateway.authorize({
      paymentId,
      merchantId,
      amountMinor: settled.amountMinor,
      currency: settled.currency,
      methodToken: data.methodToken,
      idempotencyKey,
    });
    try {
      const payment = await payments.insert({
        paymentId,
        merchantId,
        amountMinor: data.amountMinor,
        currency: data.currency,
        status: receipt.status,
        gatewayPaymentId: receipt.gatewayPaymentId,
        refundedMinor: 0,
        settlementAmountMinor: settled.amountMinor,
        settlementCurrency: settled.currency,
        quoteId: settled.quoteId,
        idempotencyKey,
      });
      logger.info(`payment ${paymentId} created for ${merchantId}`);
      return payment;
    } catch (error) {
      if (error.code !== 'UNIQUE_VIOLATION') throw error;
      const raced = await payments.findByIdempotencyKey(
        merchantId,
        idempotencyKey,
      );
      if (raced) return raced;
      throw error;
    }
  };

module.exports = { create };
