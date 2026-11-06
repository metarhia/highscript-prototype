'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const confirmPayment = require('../confirmPayment.js');
const cancelPayment = require('../cancelPayment.js');
const getPaymentStatus = require('../getPaymentStatus.js');
const getTransactionHistory = require('../getTransactionHistory.js');
const managePaymentMethods = require('../managePaymentMethods.js');
const { createRepository, createGateway, logger } = require('./fakes.js');

const setup = async (status = 'created') => {
  const payments = createRepository();
  const gateway = createGateway();
  await payments.insert({
    paymentId: 'p-1',
    merchantId: 'M-1',
    amountMinor: 2500,
    currency: 'EUR',
    status,
    gatewayPaymentId: 'gw-1',
    refundedMinor: 0,
  });
  const ports = { payments, gateway, logger };
  return {
    payments,
    gateway,
    confirm: confirmPayment.create(ports),
    cancel: cancelPayment.create(ports),
  };
};

const ref = { paymentId: 'p-1', idempotencyKey: 'k-1' };

test('confirm and cancel move a created payment once', async () => {
  const first = await setup();
  assert.equal((await first.confirm(ref)).status, 'confirmed');
  assert.equal((await first.confirm(ref)).status, 'confirmed');
  assert.equal(first.gateway.calls.length, 1, 'repeated confirm is a no-op');
  await assert.rejects(first.cancel(ref), { code: 'INVALID_STATE' });
  const second = await setup();
  assert.equal((await second.cancel(ref)).status, 'cancelled');
  const kinds = second.payments.transactions.map((item) => item.kind);
  assert.deepEqual(kinds, ['create', 'cancel']);
});

test('gateway failure leaves the payment unchanged', async () => {
  const { payments, confirm } = await setup();
  const failing = createGateway({ fail: 'confirm' });
  const broken = confirmPayment.create({ payments, gateway: failing, logger });
  await assert.rejects(broken(ref), { code: 'GATEWAY_FAILURE' });
  assert.equal((await payments.findById('p-1')).status, 'created');
  assert.equal((await confirm(ref)).status, 'confirmed');
});

test('status and history read through the repository', async () => {
  const { payments } = await setup();
  const status = getPaymentStatus.create({ payments });
  assert.equal((await status({ paymentId: 'p-1' })).status, 'created');
  await assert.rejects(status({ paymentId: 'nope' }), {
    code: 'PAYMENT_NOT_FOUND',
  });
  const page = { items: [], nextCursor: null };
  const history = getTransactionHistory.create({
    payments: {
      history: async (merchantId, query) => ({ ...page, merchantId, query }),
    },
  });
  const result = await history({ merchantId: ' M-1 ', limit: 5 });
  assert.equal(result.merchantId, 'M-1', 'merchant id is trimmed');
  assert.deepEqual(result.query, { cursor: undefined, limit: 5 });
});

test('payment methods are managed by the gateway', async () => {
  const command = { merchantId: 'M-1', action: 'list' };
  const gateway = {
    manageMethods: async (input) => ({ tokens: [input.action] }),
  };
  const manage = managePaymentMethods.create({ gateway });
  assert.deepEqual(await manage(command), { tokens: ['list'] });
});
