'use strict';

// In-memory fakes with the same shape as persistence.Repository and the
// remote PaymentGateway / CurrencyExchange stubs.

const createRepository = () => {
  const payments = new Map();
  const transactions = [];
  const events = new Map();
  let sequence = 0;
  const find = (predicate) => {
    const found = [...payments.values()].find(predicate);
    return found ? { ...found } : null;
  };
  return {
    transactions,
    newId: () => `pay-${++sequence}`,
    findById: async (id) => (payments.has(id) ? { ...payments.get(id) } : null),
    findByIdempotencyKey: async (merchantId, key) =>
      find(
        (item) => item.merchantId === merchantId && item.idempotencyKey === key,
      ),
    findByGatewayId: async (id) => find((item) => item.gatewayPaymentId === id),
    findRequest: async (paymentId, key) =>
      transactions.find(
        (item) => item.paymentId === paymentId && item.idempotencyKey === key,
      ) || null,
    isEventKnown: async (eventId) => events.has(eventId),
    insert: async (payment) => {
      payments.set(payment.paymentId, { ...payment });
      transactions.push({ paymentId: payment.paymentId, kind: 'create' });
      return { ...payment };
    },
    transition: async (paymentId, decide) => {
      const current = payments.get(paymentId);
      const step = decide({ ...current });
      if (!step) return { payment: { ...current }, applied: false };
      const next = { ...current, ...step.changes };
      payments.set(paymentId, next);
      const { kind, amountMinor, idempotencyKey } = step;
      transactions.push({ paymentId, kind, amountMinor, idempotencyKey });
      return { payment: { ...next }, applied: true };
    },
    registerEvent: async (event) => {
      if (events.has(event.eventId)) return false;
      events.set(event.eventId, event);
      return true;
    },
  };
};

const createGateway = ({ fail = null } = {}) => {
  const calls = [];
  let sequence = 0;
  const call = (name, result) => async (input) => {
    calls.push({ name, input });
    if (fail === name) {
      throw Object.assign(new Error('Card declined'), {
        code: 'GATEWAY_FAILURE',
      });
    }
    return result(input);
  };
  return {
    calls,
    authorize: call('authorize', () => ({
      gatewayPaymentId: `gw-${++sequence}`,
      status: 'created',
      refundedMinor: 0,
    })),
    confirm: call('confirm', ({ gatewayPaymentId }) => ({
      gatewayPaymentId,
      status: 'confirmed',
    })),
    cancel: call('cancel', ({ gatewayPaymentId }) => ({
      gatewayPaymentId,
      status: 'cancelled',
    })),
    refund: call('refund', ({ gatewayPaymentId }) => ({
      gatewayPaymentId,
      status: 'confirmed',
    })),
  };
};

const createExchange = ({ rate = 1.08, fail = false } = {}) => ({
  calls: 0,
  async quote({ amountMinor, to }) {
    this.calls++;
    if (fail) {
      const error = new Error('Exchange is down');
      throw Object.assign(error, { code: 'EXCHANGE_FAILURE' });
    }
    return {
      quoteId: 'q-1',
      amountMinor: Math.round(amountMinor * rate),
      currency: to,
    };
  },
});

const logger = { debug() {}, info() {}, warn() {}, error() {} };

module.exports = { createRepository, createGateway, createExchange, logger };
