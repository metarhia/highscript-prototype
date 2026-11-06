'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const createPayment = require('../createPayment.js');
const normalizePayment = require('../normalizePayment.js');
const {
  createRepository,
  createGateway,
  createExchange,
  logger,
} = require('./fakes.js');

const setup = (options = {}) => {
  const ports = {
    payments: createRepository(),
    gateway: createGateway(options.gateway),
    exchange: createExchange(options.exchange),
    normalize: normalizePayment.create(),
    settlement: { currency: 'USD' },
    logger,
  };
  return { ...ports, create: createPayment.create(ports) };
};

const input = {
  merchantId: ' M-1 ',
  amountMinor: 2500,
  currency: 'eur',
  methodToken: 'tok_visa',
  idempotencyKey: 'k-1',
};

test('authorizes the amount converted to settlement currency', async () => {
  const { create, gateway } = setup();
  const payment = await create(input);
  assert.equal(payment.merchantId, 'M-1');
  assert.equal(payment.currency, 'EUR');
  assert.equal(payment.settlementAmountMinor, 2700);
  assert.equal(payment.settlementCurrency, 'USD');
  assert.equal(payment.quoteId, 'q-1');
  assert.equal(gateway.calls[0].input.amountMinor, 2700);
});

test('skips exchange for the settlement currency', async () => {
  const { create, exchange } = setup();
  const payment = await create({ ...input, currency: 'USD' });
  assert.equal(payment.quoteId, null);
  assert.equal(exchange.calls, 0);
});

test('idempotency: same key replays, other data conflicts', async () => {
  const { create, gateway } = setup();
  const first = await create(input);
  const again = await create(input);
  assert.equal(again.paymentId, first.paymentId);
  assert.equal(gateway.calls.length, 1);
  await assert.rejects(create({ ...input, amountMinor: 1 }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
});

test('remote failures keep adapter codes, nothing is stored', async () => {
  const declined = setup({ gateway: { fail: 'authorize' } });
  await assert.rejects(declined.create(input), { code: 'GATEWAY_FAILURE' });
  assert.equal(declined.payments.transactions.length, 0);
  const offline = setup({ exchange: { fail: true } });
  await assert.rejects(offline.create(input), { code: 'EXCHANGE_FAILURE' });
});
