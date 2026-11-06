'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const highscript = require('../lib/index.js');
const { writeTree, factory } = require('./helpers.js');

const tree = (files) => highscript.load(writeTree(files, 'Shop'));

const codes = (items) => [...new Set(items.map((item) => item.code))].sort();

// One planted problem per warning and hint.
const FILES = {
  'solution.js': '({ exposes: { Backend, Web } });',
  'contracts/Orders/v1.js': `({
  getOrder: { input: schemas.OrderQuery, output: schemas.Order },
});`,
  'contracts/Orders/v2.js': `({
  getOrder: { input: schemas.OrderQuery, output: schemas.Order },
});`,
  'schemas/OrderQuery.js': `({ id: 'string' });`,
  'schemas/Order.js': `({ id: 'string' });`,
  'schemas/Unused.js': `({ id: 'string' });`,
  'schemas/Local.js': `({ id: 'string' });`,
  'Backend/application.js': `({
  exposes: {
    server: {
      contract: contracts.Orders,
      transport: 'http-json',
      open: { options: config.server, logger, api: Orders },
    },
  },
});`,
  'Backend/config/server.json': '{ "port": 0 }',
  'Backend/config/logger.json': '{ "level": "silent" }',
  'Backend/config/extra.json': '{}',
  'Backend/config/test/ghost.json': '{}',
  'Backend/server.js': factory(
    'open',
    '{ options, logger, api, contract }',
    '({})',
  ),
  'Backend/logger.js': factory('open', '{ options }', '({ info() {} })'),
  'Backend/orphan.js': factory('create', ''),
  'Backend/Orders/service.js': `({
  consumes: { logger, clock },
  exposes: {
    getOrder: {
      contract: contracts.Orders.v2.getOrder,
      create: { read: store.read, shape: schemas.Local },
    },
    ping: {},
  },
});`,
  'Backend/Orders/getOrder.js': factory(
    'create',
    '{ read, shape }',
    `async () => {\n  throw new Error('Not implemented: getOrder');\n}`,
  ),
  'Backend/Orders/ping.js': factory('create', '{ logger }'),
  'Backend/Orders/store/component.js':
    '({ exposes: { read: {}, write: {} } });',
  'Backend/Orders/store/read.js': factory('create', ''),
  'Backend/Orders/store/write.js': factory('create', ''),
  'Web/application.js': `({
  consumes: { orders: { from: Backend.server.v2, via: transport } },
  exposes: { ui: { open: { orders } } },
});`,
};

test('check compares code with DSL: warnings and hints', () => {
  const { errors, warnings, hints } = highscript.check(tree(FILES));
  assert.deepEqual(errors.map(String), []);
  assert.deepEqual(codes(warnings), [
    'DESIGN_ONLY',
    'ENV_SECTION',
    'STUB',
    'UNREACHABLE',
    'UNUSED_CONFIG',
    'UNUSED_CONSUMES',
    'UNUSED_DEFINITION',
  ]);
  assert.deepEqual(codes(hints), [
    'MISSING_TEST',
    'NO_CONTRACT',
    'PLACEMENT',
    'SCAFFOLD',
    'UNUSED_EXPOSES',
    'UNUSED_VERSION',
  ]);
  const text = [...warnings, ...hints].map(String).join('\n');
  assert.match(text, /orphan\.js: component is not reachable/);
  assert.match(text, /consumes\.clock is not used/);
  assert.match(text, /extra\.json: section "extra" is not used/);
  assert.match(text, /schemas\.Unused is not used/);
  assert.match(
    text,
    /schemas\.Local is used only inside Shop\.Backend\.Orders/,
  );
  assert.match(text, /contracts\.Orders\.v1 is not pinned/);
  assert.match(text, /exposes\.write is not used/);
  assert.match(text, /4 file\(s\) can be generated/);
});

test('check collects errors of every root with stable codes', () => {
  const model = tree({
    'solution.js': '({ exposes: { App } });',
    'App/application.js': `({
  exposes: {
    a: { create: { missing } },
    b: { create: { other: c } },
  },
});`,
    'App/a.js': factory('create', '{ missing }'),
    'App/b.js': factory('create', '{ wrong }'),
    'App/c.js': factory('create', ''),
  });
  const { errors } = highscript.check(model);
  assert.deepEqual(codes(errors), ['SIGNATURE', 'UNRESOLVED']);
});

test('locate finds the model from a nested folder or its parent', () => {
  const model = tree(FILES);
  const nested = path.join(model.rootDir, 'Backend', 'Orders', 'store');
  assert.equal(highscript.locate(nested), nested);
  assert.equal(highscript.locate(path.dirname(model.rootDir)), model.rootDir);
});

test('schema shorthands, version order, exposes used by siblings', () => {
  const versions = Object.fromEntries(
    [1, 2, 9, 10].map((n) => [
      `contracts/Api/v${n}.js`,
      '({ get: { input: schemas.Order } });',
    ]),
  );
  const model = tree({
    ...versions,
    'solution.js': '({ exposes: { App } });',
    'schemas/Order.js': `({ customer: 'Customer', shipTo: '?Address' });`,
    'schemas/Customer.js': `({ name: 'string' });`,
    'schemas/Address.js': `({ city: 'string' });`,
    'App/application.js': `({
  exposes: {
    get: { contract: contracts.Api.v10.get, create: { api: Ops.place } },
  },
});`,
    'App/get.js': factory('create', '{ api }'),
    'App/Ops/service.js': `({
  consumes: {},
  exposes: { place: {}, charge: {} },
});`,
    'App/Ops/place.js': factory('create', '{ charge }'),
    'App/Ops/charge.js': factory('create', ''),
  });
  const versionsLoaded = model.units.get('Shop').contracts.get('Api').versions;
  assert.deepEqual([...versionsLoaded.keys()], ['v1', 'v2', 'v9', 'v10']);
  const { errors, warnings, hints } = highscript.check(model);
  assert.deepEqual(errors.map(String), []);
  const text = [...warnings, ...hints].map(String).join('\n');
  assert.doesNotMatch(text, /schemas\.(Customer|Address) is not used/);
  assert.match(text, /contracts\.Api\.v9 is not pinned/);
  assert.doesNotMatch(text, /Api\.v10 is not pinned/);
  assert.match(
    text,
    /exposes\.charge is not used/,
    'reached only by a sibling',
  );
  assert.doesNotMatch(text, /exposes\.place is not used/);
});
