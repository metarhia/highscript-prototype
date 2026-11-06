'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { setImmediate: tick } = require('node:timers/promises');
const highscript = require('../../../../platform/lib/index.js');
const ui = require('../ui/ui.js');
const { createDocument } = require('./dom.js');

const APP = 'Enterprise.PaymentSystem.WebClient';
const FORM = 'Enterprise.PaymentSystem.schemas.PaymentForm';

// PaymentForm projection compiled from the model, payments API faked.
const form = (() => {
  const model = highscript.load(path.resolve(__dirname, '../../..'));
  return highscript
    .instantiate(highscript.plan(model, APP, { env: 'test' }))
    .schemas.get(FORM);
})();

const fakePayments = () => {
  const calls = [];
  const record = (name, result) => async (input) => {
    calls.push({ name, input });
    return result(input);
  };
  return {
    calls,
    managePaymentMethods: record('managePaymentMethods', () => ({
      tokens: ['tok_visa'],
    })),
    getTransactionHistory: record('getTransactionHistory', () => ({
      items: [],
      nextCursor: null,
    })),
    createPayment: record('createPayment', (input) => ({
      ...input,
      paymentId: 'p-123456789',
      status: 'created',
      gatewayPaymentId: 'gw-1',
      refundedMinor: 0,
      settlementAmountMinor: input.amountMinor,
      settlementCurrency: 'USD',
      createdAt: 'now',
      updatedAt: 'now',
    })),
  };
};

let document = null;
before(() => {
  document = createDocument();
  globalThis.document = document;
});
after(() => {
  delete globalThis.document;
});

test('renders the form from the PaymentForm projection and pays', async () => {
  const payments = fakePayments();
  const component = ui.open({ payments, form });
  await component.start();
  const root = document.getElementById('app');
  const selects = root.findAll((node) => node.tagName === 'SELECT');
  const currencies = selects[0].childNodes.map((option) => option.value);
  assert.deepEqual(currencies, ['USD', 'EUR', 'UAH']);
  const tokens = selects[1].childNodes.map((option) => option.value);
  assert.deepEqual(tokens, ['tok_visa']);
  const forms = root.findAll((node) => node.tagName === 'FORM');
  const payForm = forms.find((node) => node.textContent.includes('Pay'));
  payForm.dispatch('submit');
  await tick();
  const call = payments.calls.find((item) => item.name === 'createPayment');
  assert.equal(call.input.amountMinor, 2500);
  assert.equal(call.input.currency, 'EUR');
  assert.ok(call.input.idempotencyKey);
  assert.match(root.textContent, /p-123456/);
  assert.match(root.textContent, /Payment created/);
  component.close();
  assert.equal(root.childNodes.length, 0);
});

test('controller validates input with the projection', async () => {
  const payments = fakePayments();
  const { controller } = ui.open({ payments, form });
  const fields = {
    merchantId: 'M-1',
    amountMinor: 0,
    currency: 'EUR',
    methodToken: 'tok',
  };
  await assert.rejects(controller.pay(fields), { code: 'INVALID_INPUT' });
  assert.equal(payments.calls.length, 0);
});
