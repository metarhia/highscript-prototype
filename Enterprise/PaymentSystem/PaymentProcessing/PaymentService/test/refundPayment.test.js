'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const refundPayment = require('../refundPayment.js');
const { createRepository, createGateway, logger } = require('./fakes.js');

const setup = async (status = 'confirmed') => {
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
    settlementAmountMinor: 2700,
    settlementCurrency: 'USD',
  });
  return {
    payments,
    gateway,
    refund: refundPayment.create({ payments, gateway, logger }),
  };
};

test('partial refunds add up to the settled amount exactly', async () => {
  const { refund, gateway } = await setup();
  const partial = await refund({
    paymentId: 'p-1',
    amountMinor: 1000,
    idempotencyKey: 'r-1',
  });
  assert.equal(partial.status, 'confirmed');
  assert.equal(partial.refundedMinor, 1000);
  const full = await refund({
    paymentId: 'p-1',
    amountMinor: 1500,
    idempotencyKey: 'r-2',
  });
  assert.equal(full.status, 'refunded');
  const settled = gateway.calls.map((call) => call.input.amountMinor);
  assert.deepEqual(settled, [1080, 1620]);
});

test('repeated request with the same key is not refunded twice', async () => {
  const { refund, gateway } = await setup();
  await refund({ paymentId: 'p-1', amountMinor: 1000, idempotencyKey: 'r-1' });
  const again = await refund({
    paymentId: 'p-1',
    amountMinor: 1000,
    idempotencyKey: 'r-1',
  });
  assert.equal(again.refundedMinor, 1000);
  assert.equal(gateway.calls.length, 1);
});

test('refund rules: remaining amount and payment state', async () => {
  const { refund } = await setup();
  await assert.rejects(
    refund({ paymentId: 'p-1', amountMinor: 2600, idempotencyKey: 'r' }),
    {
      code: 'INVALID_INPUT',
    },
  );
  await assert.rejects(
    refund({ paymentId: 'nope', amountMinor: 1, idempotencyKey: 'r' }),
    {
      code: 'PAYMENT_NOT_FOUND',
    },
  );
  const created = await setup('created');
  await assert.rejects(
    created.refund({ paymentId: 'p-1', amountMinor: 1, idempotencyKey: 'r' }),
    { code: 'INVALID_STATE' },
  );
});
