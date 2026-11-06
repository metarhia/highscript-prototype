'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SchemaRegistry } = require('../lib/schema.js');

const positive = (value) => Number.isSafeInteger(value) && value > 0;
const registry = new SchemaRegistry(
  [
    {
      id: 'Item',
      name: 'Item',
      definition: {
        sku: 'string',
        amount: {
          type: 'number',
          validate: { $lib: 'rules', path: ['positive'] },
        },
        note: '?string',
        kind: { enum: ['a', 'b'] },
        identity: { primary: ['sku'] },
      },
    },
    {
      id: 'Order',
      name: 'Order',
      definition: { items: { array: 'Item' } },
      refs: { Item: 'Item' },
    },
    {
      id: 'ItemForm',
      name: 'ItemForm',
      definition: {
        Projection: {
          schema: 'Item',
          fields: ['sku', 'kind'],
          ui: { kind: 'select' },
        },
      },
      refs: { Item: 'Item' },
    },
  ],
  (spec) => ({ positive })[spec.path[0]],
);

test('check: types, optional, enum, validators, nesting', () => {
  const item = registry.get('Item');
  assert.equal(item.check({ sku: 'x', amount: 1, kind: 'a' }).valid, true);
  assert.equal(
    item.check({ sku: 'x', amount: 1, kind: 'a', note: null }).valid,
    true,
  );
  const { errors } = item.check({ sku: 1, amount: -1, kind: 'c', extra: 1 });
  assert.deepEqual(errors, [
    'extra: unknown field',
    'sku: expected string',
    'amount: invalid value',
    'kind: expected one of a, b',
  ]);
  const order = registry.get('Order');
  assert.deepEqual(
    order.check({ items: [{ sku: 'x', amount: 0, kind: 'a' }] }).errors,
    ['items[0].amount: invalid value'],
  );
  assert.deepEqual(item.metadata.primary, ['sku']);
});

test('projection: fields, ui hints, project()', () => {
  const form = registry.get('ItemForm');
  assert.deepEqual(Object.keys(form.fields), ['sku', 'kind']);
  assert.equal(form.ui.kind, 'select');
  assert.deepEqual(form.project({ sku: 'x', kind: 'a', amount: 5 }), {
    sku: 'x',
    kind: 'a',
  });
});
