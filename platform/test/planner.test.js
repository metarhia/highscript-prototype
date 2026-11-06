'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const highscript = require('../lib/index.js');
const { writeTree, factory } = require('./helpers.js');

const tree = (files) => highscript.load(writeTree(files));

const base = {
  'solution.js': '({ exposes: { App } });',
  'contracts/Api/v1.js':
    '({ get: { input: schemas.Query, output: schemas.Query } });',
  'contracts/Api/v2.js': '({ get: contracts.Api.v1.get });',
  'schemas/Query.js': `({ id: 'string' });`,
  'App/config/store.json': '{ "path": "data" }',
  'App/store.js': factory('open', '{ options }'),
};

test('private elements are not reachable through a unit boundary', () => {
  const model = tree({
    ...base,
    'App/application.js':
      '({ exposes: { api: { create: { repo: Service.repo } } } });',
    'App/api.js': factory('create', '{ repo }'),
    'App/Service/service.js': '({ exposes: { get: {} } });',
    'App/Service/get.js': factory('create', ''),
    'App/Service/repo.js': factory('create', ''),
  });
  const { errors } = highscript.check(model);
  assert.match(errors.join('\n'), /"repo" is private in Root\.App\.Service/);
});

test('versioned endpoint is pinned, signature matches ports', () => {
  const model = tree({
    ...base,
    'App/application.js': `({
      exposes: {
        server: {
          contract: contracts.Api,
          transport: 'http-json',
          open: { store },
        },
      },
    });`,
    'App/server.js': factory('open', '{ store, extra }'),
    'Client/application.js': `({
      consumes: { api: { from: App.server, via: transport } },
      exposes: { ui: { open: { api } } },
    });`,
    'Client/transport.js': factory('open', ''),
    'Client/ui.js': factory('open', '{ api }'),
  });
  const { errors } = highscript.check(model);
  const text = errors.join('\n');
  assert.match(text, /does not match ports \{ store \}/);
  assert.match(text, /Api is versioned, pin a version/);
});

test('reserved names, code above application and unknown sections', () => {
  const model = tree({
    'solution.js': '({ runtime: "node", exposes: {} });',
    'helper.js': factory('create', ''),
    'App/application.js': '({});',
    'App/config.js': factory('create', ''),
  });
  const text = model.diagnostics.errors.join('\n');
  assert.match(text, /unknown section "runtime"/);
  assert.match(text, /code is not allowed in solution/);
  assert.match(text, /reserved name "config"/);
});

test('plan: by-name ports, options, shared contracts', () => {
  const model = tree({
    ...base,
    'App/application.js': `({
      exposes: { get: { contract: contracts.Api.v2.get, create: { store } } },
    });`,
    'App/get.js': factory('create', '{ store }'),
  });
  const plan = highscript.plan(model, 'Root.App');
  assert.deepEqual(plan.nodes['Root.App.store'].ports.options, {
    value: { path: 'data' },
  });
  assert.equal(plan.roots.get.checked, 'Root.contracts.Api.v1.get');
});

test('components cannot require sibling components', () => {
  const model = tree({
    ...base,
    'App/application.js': '({ exposes: { a: {} } });',
    'App/a.js': `'use strict';\nrequire('./b.js');\n${factory('create', '')}`,
    'App/b.js': factory('create', ''),
  });
  const { errors } = highscript.check(model);
  assert.match(errors.join('\n'), /leaves the component boundary/);
});
