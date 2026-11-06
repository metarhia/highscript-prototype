'use strict';

const newKey = () => globalThis.crypto.randomUUID();

const failure = (code, message) => Object.assign(new Error(message), { code });

const createController = ({ payments, form }) => {
  const state = {
    merchantId: 'M-1',
    methods: [],
    payments: [],
    history: { items: [], nextCursor: null },
    message: null,
    busy: false,
  };
  const listeners = new Set();
  // One idempotency key per user action, kept until the action succeeds,
  // so retries after network failures cannot charge twice.
  const pending = new Map();

  const emit = () => {
    for (const listener of listeners) listener(state);
  };

  const keyFor = (action) => {
    if (!pending.has(action)) pending.set(action, newKey());
    return pending.get(action);
  };

  const remember = (payment) => {
    const index = state.payments.findIndex(
      (item) => item.paymentId === payment.paymentId,
    );
    if (index === -1) state.payments.unshift(payment);
    else state.payments[index] = payment;
    return payment;
  };

  const run = async (label, action) => {
    state.busy = true;
    state.message = null;
    emit();
    try {
      const result = await action();
      state.message = { type: 'info', text: label };
      return result;
    } catch (error) {
      state.message = {
        type: 'error',
        text: `${error.code || 'ERROR'}: ${error.message}`,
      };
      throw error;
    } finally {
      state.busy = false;
      emit();
    }
  };

  const methods = (action, methodToken) =>
    run(`Payment methods: ${action}`, async () => {
      const command = { merchantId: state.merchantId, action };
      if (methodToken) command.methodToken = methodToken;
      const { tokens } = await payments.managePaymentMethods(command);
      state.methods = tokens;
      return tokens;
    });

  const paymentAction =
    (name, label, call) =>
    (paymentId, ...args) => {
      const action = `${name}:${paymentId}:${args.join(':')}`;
      return run(label, async () => {
        const payment = await call(paymentId, keyFor(action), ...args);
        pending.delete(action);
        return remember(payment);
      });
    };

  return {
    state,
    form,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMerchant(merchantId) {
      state.merchantId = merchantId.trim();
      state.methods = [];
      state.payments = [];
      state.history = { items: [], nextCursor: null };
      emit();
    },
    loadMethods: () => methods('list'),
    addMethod: (methodToken) => methods('add', methodToken),
    removeMethod: (methodToken) => methods('remove', methodToken),

    pay(fields, { idempotencyKey } = {}) {
      const action = `pay:${JSON.stringify(fields)}`;
      return run('Payment created', async () => {
        const { valid, errors } = form.check(fields);
        if (!valid) throw failure('INVALID_INPUT', errors.join('; '));
        const key = idempotencyKey || keyFor(action);
        const payment = await payments.createPayment({
          ...fields,
          idempotencyKey: key,
        });
        pending.delete(action);
        return remember(payment);
      });
    },

    confirm: paymentAction('confirm', 'Payment confirmed', (paymentId, key) =>
      payments.confirmPayment({ paymentId, idempotencyKey: key }),
    ),
    cancel: paymentAction('cancel', 'Payment cancelled', (paymentId, key) =>
      payments.cancelPayment({ paymentId, idempotencyKey: key }),
    ),
    refund: paymentAction(
      'refund',
      'Refund accepted',
      (paymentId, key, amountMinor) =>
        payments.refundPayment({ paymentId, amountMinor, idempotencyKey: key }),
    ),

    refresh: (paymentId) =>
      run('Payment refreshed', async () =>
        remember(await payments.getPaymentStatus({ paymentId })),
      ),

    loadHistory({ more = false, limit = 10 } = {}) {
      return run('History loaded', async () => {
        const query = { merchantId: state.merchantId, limit };
        if (more && state.history.nextCursor) {
          query.cursor = state.history.nextCursor;
        }
        const page = await payments.getTransactionHistory(query);
        const items = more
          ? [...state.history.items, ...page.items]
          : page.items;
        state.history = { items, nextCursor: page.nextCursor ?? null };
        return page;
      });
    },
  };
};

module.exports = { createController };
