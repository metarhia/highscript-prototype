'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const highscript = require('../../../../../../platform/lib/index.js');

const APP = 'Enterprise.PaymentSystem.PaymentProcessing';
const REPOSITORY = `${APP}.PaymentService.persistence.Repository`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repository-'));

// Repository with the real driver and record schemas from the model,
// database section overridden with a temporary folder.
const open = async () => {
  const model = highscript.load(path.resolve(__dirname, '../../../..'));
  const config = { database: { directory } };
  const plan = highscript.plan(model, APP, { env: 'test', config });
  const assembly = highscript.instantiate(plan);
  return { assembly, repository: await assembly.node(REPOSITORY) };
};

const payment = (id, key) => ({
  paymentId: id,
  merchantId: 'M-1',
  amountMinor: 1000,
  currency: 'USD',
  status: 'created',
  gatewayPaymentId: `gw-${id}`,
  refundedMinor: 0,
  settlementAmountMinor: 1000,
  settlementCurrency: 'USD',
  quoteId: null,
  idempotencyKey: key,
});

let context = null;
before(async () => {
  context = await open();
});
after(async () => {
  await context.assembly.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('insert logs creation, unique keys hold', async () => {
  const { repository } = context;
  await repository.insert(payment('p-1', 'k-1'));
  await assert.rejects(repository.insert(payment('p-2', 'k-1')), {
    code: 'UNIQUE_VIOLATION',
  });
  assert.equal(
    (await repository.findByIdempotencyKey('M-1', 'k-1')).paymentId,
    'p-1',
  );
  assert.equal((await repository.findByGatewayId('gw-p-1')).paymentId, 'p-1');
});

test('record schema is enforced like table constraints', async () => {
  const { repository } = context;
  const invalid = { ...payment('p-3', 'k-3'), amountMinor: -1 };
  await assert.rejects(repository.insert(invalid), { code: 'CONSTRAINT' });
});

test('concurrent transitions: only one is applied', async () => {
  const { repository } = context;
  const decide = (current) =>
    current.status === 'created'
      ? {
          changes: { status: 'confirmed' },
          kind: 'confirm',
          amountMinor: current.amountMinor,
        }
      : null;
  const results = await Promise.all([
    repository.transition('p-1', decide),
    repository.transition('p-1', decide),
  ]);
  assert.deepEqual(results.map((item) => item.applied).sort(), [false, true]);
  assert.equal((await repository.findById('p-1')).status, 'confirmed');
});

test('history pages newest first and data survives reopening', async () => {
  const { repository } = context;
  await repository.insert(payment('p-4', 'k-4'));
  const first = await repository.history('M-1', { limit: 2 });
  assert.deepEqual(
    first.items.map((item) => item.kind),
    ['create', 'confirm'],
  );
  const second = await repository.history('M-1', {
    cursor: first.nextCursor,
    limit: 2,
  });
  assert.deepEqual(
    second.items.map((item) => item.kind),
    ['create'],
  );
  assert.equal(second.nextCursor, null);
  const reopened = await open();
  assert.equal((await reopened.repository.findById('p-4')).paymentId, 'p-4');
  await reopened.assembly.close();
});
