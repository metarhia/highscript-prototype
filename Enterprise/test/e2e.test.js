'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, before, after } = require('node:test');
const highscript = require('../../platform/lib/index.js');
const { openLogger } = require('../../platform/adapters/logger.js');
const { run } = require('./scenario.js');

const ROOT = path.resolve(__dirname, '../..');
const env = 'test';
const silent = openLogger({ level: 'silent' });
let model = null;
let landscape = null;

before(async () => {
  process.chdir(ROOT);
  fs.rmSync(path.join(ROOT, '.data', env), { recursive: true, force: true });
  model = highscript.load(path.join(ROOT, 'Enterprise'));
  landscape = await highscript.up(model, model.root, { env, log: silent });
});

after(() => landscape?.close());

test('architecture check: no errors, design-only clients to scaffold', () => {
  const { errors, warnings, hints } = highscript.check(model, { env });
  const codes = (items) => items.map(({ code }) => code);
  assert.deepEqual(errors.map(String), []);
  assert.deepEqual(codes(warnings), ['DESIGN_ONLY', 'DESIGN_ONLY']);
  assert.deepEqual(codes(hints), ['SCAFFOLD']);
  assert.match(String(hints[0]), /5 file\(s\) can be generated/);
});

test('landscape runs implemented applications only', () => {
  const ids = landscape.running.map((item) => item.id).sort();
  assert.deepEqual(ids, [
    'Enterprise.CurrencyExchange.ExchangeMock',
    'Enterprise.PaymentGateway.GatewayMock',
    'Enterprise.PaymentSystem.PaymentProcessing',
    'Enterprise.PaymentSystem.WebClient',
  ]);
  assert.deepEqual(landscape.skipped.sort(), [
    'Enterprise.PaymentSystem.MobileClient',
    'Enterprise.PaymentSystem.Terminal',
  ]);
});

test('end-to-end scenario', () => run({ model, env, highscript }));

test('data is stored as JSON files', () => {
  const payments = JSON.parse(
    fs.readFileSync('.data/test/payments/payments.json', 'utf8'),
  );
  const charges = JSON.parse(
    fs.readFileSync('.data/test/gateway/charges.json', 'utf8'),
  );
  const quotes = JSON.parse(
    fs.readFileSync('.data/test/exchange/quotes.json', 'utf8'),
  );
  assert.equal(payments.length, 2);
  assert.equal(charges.length, 2);
  assert.equal(quotes.length, 2, 'EUR payment and the declined EUR attempt');
});

test('browser bundle assembles in a VM and calls the server', async () => {
  const served = landscape.running.find((item) =>
    item.id.endsWith('WebClient'),
  );
  const html = await (await fetch(served.address)).text();
  assert.match(html, /<script src="app\.js">/);
  const js = await (await fetch(`${served.address}app.js`)).text();
  const context = vm.createContext({
    fetch,
    AbortSignal,
    structuredClone,
    crypto,
    console,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(js, context, { filename: 'app.js' });
  const app = await context.highscript.ready;
  const { controller } = app.roots.ui;
  controller.setMerchant('M-bundle');
  const tokens = await controller.addMethod('tok_bundle');
  assert.deepEqual([...tokens], ['tok_bundle']);
  await app.close();
});
