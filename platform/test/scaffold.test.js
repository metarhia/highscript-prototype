'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const highscript = require('../lib/index.js');
const { writeTree } = require('./helpers.js');

// DSL only, in all three syntaxes: a backend serving Orders v1 and a web
// client consuming it. No code, no config, no Orders service yet.
const FILES = {
  'solution.md': ['- exposes', '  - Backend', '  - Web', ''].join('\n'),
  'contracts/Orders/v1.lisp': [
    '(placeOrder (input schemas.OrderInput) (output schemas.Order))',
    '(getOrder (input schemas.OrderQuery) (output schemas.Order))',
    '',
  ].join('\n'),
  'schemas/OrderInput.js': `({ item: 'string', quantity: 'number' });\n`,
  'schemas/OrderQuery.js': `({ orderId: 'string' });\n`,
  'schemas/Order.js': `({ orderId: 'string', item: 'string' });\n`,
  'Backend/application.js': `({
  exposes: {
    server: {
      contract: contracts.Orders,
      transport: 'http-json',
      open: { options: config.server, logger, api: Orders },
    },
  },
});
`,
  'Web/application.lisp': [
    '(consumes (orders (from Backend.server.v1) (via transport)))',
    '(exposes (ui (open (orders))))',
    '',
  ].join('\n'),
};

const fixture = () => writeTree(FILES, 'Shop');

const names = (root, report) =>
  report.created.map((file) => path.relative(root, path.resolve(file))).sort();

test('scaffold creates units, templates and config sections', async () => {
  const root = fixture();
  const report = highscript.scaffold(root, { env: 'development' });
  assert.deepEqual(names(root, report), [
    'Backend/Orders/getOrder.js',
    'Backend/Orders/placeOrder.js',
    'Backend/Orders/service.js',
    'Backend/config/logger.json',
    'Backend/config/server.json',
    'Backend/logger.js',
    'Backend/server.js',
    'Web/config/transport.json',
    'Web/transport.js',
    'Web/ui.js',
  ]);
  assert.deepEqual(report.warnings, []);
  const service = fs.readFileSync(
    path.join(root, 'Backend/Orders/service.js'),
    'utf8',
  );
  assert.match(
    service,
    /placeOrder: \{ contract: contracts\.Orders\.v1\.placeOrder \}/,
  );
  const operation = fs.readFileSync(
    path.join(root, 'Backend/Orders/placeOrder.js'),
    'utf8',
  );
  assert.match(operation, /\/\/ placeOrder: OrderInput -> Order/);

  const again = highscript.scaffold(root, { env: 'development' });
  assert.deepEqual(again.created, [], 'second run creates nothing');

  const model = highscript.load(root);
  assert.deepEqual(highscript.check(model).errors, []);
  const config = { server: { port: 0 }, logger: { level: 'silent' } };
  const backend = await highscript.start(model, 'Shop.Backend', { config });
  const url = `${backend.roots.server.address}/api/Orders/v1/placeOrder`;
  const body = JSON.stringify({ item: 'book', quantity: 1 });
  const response = await fetch(url, { method: 'POST', body });
  assert.equal(
    response.status,
    500,
    'templates assemble, operations are stubs',
  );
  const invalid = await fetch(url, { method: 'POST', body: '{}' });
  assert.equal(
    invalid.status,
    400,
    'contract is enforced by the generated server',
  );
  await backend.close();
});

test('scaffold keeps edited files, check reports signature drift', () => {
  const root = fixture();
  highscript.scaffold(root);
  const server = path.join(root, 'Backend/server.js');
  const edited = [
    `'use strict';`,
    'const open = ({ options }) => ({ options });',
    'module.exports = { open };',
    '',
  ].join('\n');
  fs.writeFileSync(server, edited);
  assert.deepEqual(highscript.scaffold(root).created, []);
  assert.equal(fs.readFileSync(server, 'utf8'), edited);
  const { errors } = highscript.check(highscript.load(root));
  assert.deepEqual(
    errors.map(({ code }) => code),
    ['SIGNATURE'],
  );
  assert.match(String(errors[0]), /does not match ports/);
});

test('missing definitions are reported with their place, not invented', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'schemas/Order.js'), `({ item: 'Item' });`);
  const shorthand = highscript.scaffold(root, { dry: true });
  assert.match(shorthand.warnings.join('\n'), /schemas\.Item is not defined/);
  assert.equal(
    fs.existsSync(path.join(root, '.highscript-scaffold.lock')),
    false,
  );
  fs.rmSync(path.join(root, 'schemas/Order.js'));
  const report = highscript.scaffold(root, { dry: true });
  assert.match(
    report.warnings.join('\n'),
    /schemas\.Order is not defined: add it to .*Shop\/schemas\//,
  );
});

test('init and convert keep the same model in every syntax', () => {
  const root = fixture();
  highscript.scaffold(root);
  const before = highscript.plan(highscript.load(root), 'Shop.Backend');
  for (const syntax of ['md', 'lisp', 'js']) {
    highscript.convert(root, { to: syntax });
    const after = highscript.plan(highscript.load(root), 'Shop.Backend');
    assert.deepEqual(after.nodes, before.nodes);
    assert.deepEqual(after.contracts, before.contracts);
  }
  const fresh = path.join(path.dirname(root), 'Next');
  assert.deepEqual(
    highscript.init(fresh, { level: 'solution', syntax: 'md' }).length,
    1,
  );
  assert.match(
    fs.readFileSync(path.join(fresh, 'solution.md'), 'utf8'),
    /- exposes \{\}/,
  );
  assert.throws(
    () => highscript.init(fresh, { level: 'solution' }),
    /already has a level file/,
  );
});
