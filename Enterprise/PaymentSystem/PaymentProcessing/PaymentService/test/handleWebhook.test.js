'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const handleWebhook = require('../handleWebhook.js');
const { createRepository, logger } = require('./fakes.js');

const setup = async (status) => {
  const payments = createRepository();
  await payments.insert({
    paymentId: 'p-1',
    merchantId: 'M-1',
    amountMinor: 2500,
    currency: 'EUR',
    status,
    gatewayPaymentId: 'gw-1',
    refundedMinor: 1000,
  });
  return { payments, handle: handleWebhook.create({ payments, logger }) };
};

test('refund made in the gateway is applied once', async () => {
  const { payments, handle } = await setup('confirmed');
  const event = {
    eventId: 'e-1',
    gatewayPaymentId: 'gw-1',
    status: 'refunded',
  };
  assert.deepEqual(await handle(event), { accepted: true });
  assert.deepEqual(await handle(event), { accepted: true });
  const payment = await payments.findById('p-1');
  assert.equal(payment.status, 'refunded');
  assert.equal(payment.refundedMinor, 2500);
  const refunds = payments.transactions.filter(
    (item) => item.kind === 'refund',
  );
  assert.deepEqual(
    refunds.map((item) => item.amountMinor),
    [1500],
  );
});

test('notification repeating the current state is a no-op', async () => {
  const { payments, handle } = await setup('confirmed');
  await handle({
    eventId: 'e-2',
    gatewayPaymentId: 'gw-1',
    status: 'confirmed',
  });
  assert.equal(payments.transactions.length, 1);
});

test('invalid transitions and unknown payments are not applied', async () => {
  const { payments, handle } = await setup('cancelled');
  await handle({
    eventId: 'e-3',
    gatewayPaymentId: 'gw-1',
    status: 'confirmed',
  });
  assert.equal((await payments.findById('p-1')).status, 'cancelled');
  const unknown = await handle({
    eventId: 'e-4',
    gatewayPaymentId: 'gw-x',
    status: 'confirmed',
  });
  assert.deepEqual(unknown, { accepted: false });
});
