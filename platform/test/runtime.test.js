'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assemble } = require('../lib/runtime.js');

const plan = {
  application: 'App',
  schemas: { Q: { id: 'Q', name: 'Q', definition: { id: 'string' } } },
  contracts: { op: { kind: 'operation', name: 'op', input: 'Q', output: 'Q' } },
  nodes: {
    store: {
      module: 'store',
      factory: 'open',
      ports: { options: { value: { n: 1 } } },
    },
    op: {
      module: 'op',
      factory: 'create',
      ports: { store: { node: 'store' } },
    },
  },
  remotes: {},
  roots: { op: { checked: 'op', target: { node: 'op' } } },
};

test('creates in order, guards contracts, closes in reverse', async () => {
  const events = [];
  const modules = {
    store: {
      open: ({ options }) => {
        events.push('open store');
        return {
          n: options.n,
          start: () => events.push('start'),
          close: () => events.push('close store'),
        };
      },
    },
    op: {
      create: ({ store }) => {
        events.push('create op');
        return async ({ id }) => ({ id, secret: store.n });
      },
    },
  };
  const app = await assemble(plan, { loadModule: (id) => modules[id] });
  await app.start();
  assert.deepEqual(await app.roots.op({ id: 'x' }), { id: 'x' });
  await assert.rejects(app.roots.op({ id: 1 }), { code: 'INVALID_INPUT' });
  await app.close();
  await app.close();
  assert.deepEqual(events, ['open store', 'create op', 'start', 'close store']);
});
