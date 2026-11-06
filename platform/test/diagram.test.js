'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const highscript = require('../lib/index.js');
const { Graph, View } = require('../lib/diagram.js');
const { writeTree, factory } = require('./helpers.js');

const FILES = {
  'solution.js': `({
  actors: { Buyer: { consumes: { Web } } },
  consumes: { Bank: { contract: contracts.Bank } },
  exposes: { Web, Api },
});`,
  'contracts/Bank.js': '({ input: schemas.Order });',
  'contracts/Orders/v1.js': '({ getOrder: { input: schemas.Order } });',
  'schemas/Order.js': `({ id: 'string' });`,
  'Api/application.js': `({
  consumes: { Bank: { from: Bank, via: bank } },
  exposes: {
    server: {
      contract: contracts.Orders,
      transport: 'http-json',
      open: { options: config.server, api: Orders },
    },
  },
});`,
  'Api/server.js': factory('open', '{ options, api, contract }'),
  'Api/bank.js': factory('open', '{ options, logger }'),
  'Api/logger.js': factory('open', '{ options }'),
  'Api/Orders/service.js': `({
  consumes: { Bank, logger },
  exposes: {
    getOrder: {
      contract: contracts.Orders.v1.getOrder,
      create: { bank: Bank, log: logger },
    },
  },
});`,
  'Api/Orders/getOrder.js': factory('create', '{ bank, log }'),
  'Web/application.js': `({
  consumes: { orders: { from: Api.server.v1, via: transport } },
  exposes: { ui: { open: { orders } } },
});`,
};

const arrows = (model, id, depth = 1) => {
  const unit = model.units.get(id);
  const view = new View(new Graph(model, 'test'), unit, depth);
  return view
    .arrows()
    .map(({ from, to, kind, label }) =>
      [from, kind, to, label && `[${label}]`].filter(Boolean).join(' '),
    )
    .sort();
};

test('views of every level: actors, remote calls, via, requirements', () => {
  const model = highscript.load(writeTree(FILES, 'Shop'));
  assert.deepEqual(arrows(model, 'Shop'), [
    'Shop.Api remote Shop#consumes.Bank [Bank]',
    'Shop.Web remote Shop.Api [Orders v1 · http-json]',
    'actor:Buyer actor Shop.Web',
  ]);
  assert.deepEqual(arrows(model, 'Shop', 2), [
    'Shop.Api.Orders remote Shop#consumes.Bank [Bank]',
    'Shop.Api.Orders use Shop.Api.logger',
    'Shop.Api.bank use Shop.Api.logger',
    'Shop.Api.bank via Shop#consumes.Bank [via]',
    'Shop.Api.server use Shop.Api.Orders [api]',
    'Shop.Web.ui remote Shop.Api.server [Orders v1 · http-json]',
    'actor:Buyer actor Shop.Web',
  ]);
  // A service: callers outside are drawn where they meet it, a whole
  // unit used is its boundary, ports are labels when they differ.
  assert.deepEqual(arrows(model, 'Shop.Api.Orders'), [
    'Shop.Api.Orders.getOrder remote Shop#consumes.Bank [Bank]',
    'Shop.Api.Orders.getOrder use Shop.Api.logger [log]',
    'Shop.Api.server use Shop.Api.Orders [api]',
  ]);
  assert.deepEqual(arrows(model, 'Shop.Web'), [
    'Shop.Web.ui remote Shop.Api [Orders v1 · http-json]',
    'actor:Buyer actor Shop.Web',
  ]);
});

test('mermaid marks private, design-only, external parts', () => {
  const model = highscript.load(writeTree(FILES, 'Shop'));
  const text = highscript.diagram(model, 'Shop.Api');
  assert.match(
    text,
    /^%%\{init: \{"look":"classic","flowchart":\{"curve":"bumpX"/,
  );
  assert.match(text, /"look":"classic"/);
  assert.match(text, /"clusterBkg":"transparent"/);
  assert.match(text, /"edgeLabelBackground":"transparent"/);
  assert.match(text, /"nodeShadow":false/);
  assert.match(text, /"dropShadow":"none"/);
  assert.match(
    text,
    /background-color:var\(--bgColor-default,Canvas\)!important/,
  );
  assert.match(text, /filter:none !important/);
  assert.match(text, /subgraph n_Shop_Api \["Api#160;·#160;application"\]/);
  assert.match(text, /direction TB\n {4}n_Shop_Api_server\(/);
  assert.match(text, /n_Shop_Api_server\("server<br\/>Orders · http-json"\)/);
  assert.match(text, /n_Shop_Api_bank\("bank<br\/>component"\):::internal/);
  assert.match(text, /n_Shop_Web\[\["Web<br\/>application · no code"\]\]/);
  assert.match(text, /\{\{"Bank<br\/>Bank"\}\}:::requirement/);
  assert.match(
    text,
    /n_Shop_Web ==>\|"server<br\/>Orders v1<br\/>http-json"\| n_Shop_Api\n/,
  );
  assert.match(
    text,
    /n_Shop_Api -\.->\|"bank<br\/>via"\| n_Shop_consumes_Bank/,
  );
  const webAt = text.indexOf('n_Shop_Web[[');
  const apiAt = text.indexOf('subgraph n_Shop_Api ');
  const bankAt = text.indexOf('n_Shop_consumes_Bank{{');
  assert.ok(webAt !== -1 && webAt < apiAt && apiAt < bankAt);
  const web = highscript.diagram(model, 'Shop.Web');
  assert.match(web, /n_Shop_Web_ui\("ui<br\/>no code"\):::missing/);
});

test('a long list of parts is a column', () => {
  const root = path.resolve(__dirname, '../..');
  const model = highscript.load(path.join(root, 'Enterprise'));
  const service = highscript.diagram(
    model,
    'Enterprise.PaymentSystem.PaymentProcessing.PaymentService',
  );
  const at = service.indexOf('PaymentService#160;');
  assert.match(service.slice(at), /^[^\n]*\n {4}direction LR\n/);
  const client = highscript.diagram(
    model,
    'Enterprise.PaymentSystem.WebClient',
  );
  assert.match(client, /direction TB/);
});

test('documents: markdown, html and mmd', () => {
  const model = highscript.load(writeTree(FILES, 'Shop'));
  const md = highscript.diagrams(model);
  const titles = md.match(/^## .+$/gm);
  assert.deepEqual(titles, [
    '## Shop',
    '## Shop.Web',
    '## Shop.Api',
    '## Shop.Api.Orders',
  ]);
  assert.equal(md.match(/```mermaid/g).length, 4);
  const deep = highscript.diagrams(model, 'Shop', { depth: 2 });
  assert.match(deep, /^## Landscape\n\nShop with its parts expanded/m);
  const html = highscript.diagrams(model, 'Shop', { format: 'html' });
  assert.match(html, /<pre class="mermaid">\n%%\{init: .*\nflowchart LR/);
  assert.match(html, /server&lt;br\/&gt;Orders/);
  assert.match(html, /mermaid@\d+\.\d+\.\d+\/dist\/mermaid\.esm\.min\.mjs/);
  const mmd = highscript.diagrams(model, 'Shop', { format: 'mmd' });
  assert.equal(mmd, `${highscript.diagram(model, 'Shop')}\n`);
});

test('example landscape and architecture doc are up to date', () => {
  const root = path.resolve(__dirname, '../..');
  const model = highscript.load(path.join(root, 'Enterprise'));
  const landscape = arrows(model, 'Enterprise', 2);
  const short = landscape.map((line) => line.replace(/Enterprise\./g, ''));
  for (const expected of [
    'actor:Operator actor PaymentGateway.GatewayMock',
    'actor:Customer actor PaymentSystem.MobileClient',
    'PaymentSystem.WebClient remote PaymentSystem.PaymentProcessing ' +
      '[Payments v2 · http-json]',
    'PaymentSystem.Terminal remote PaymentSystem.PaymentProcessing ' +
      '[Payments v1 · http-json]',
    'PaymentSystem.PaymentProcessing remote PaymentGateway.GatewayMock ' +
      '[PaymentGateway v1 · http-json]',
    'PaymentGateway.GatewayMock remote PaymentSystem.PaymentProcessing ' +
      '[handleWebhook · http-webhook]',
  ]) {
    assert.ok(short.includes(expected), expected);
  }
  const doc = fs.readFileSync(
    path.join(root, 'Enterprise/docs/architecture.md'),
    'utf8',
  );
  const message = 'regenerate with npm run diagram';
  assert.equal(doc, highscript.diagrams(model), message);
});
