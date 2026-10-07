'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');

const { Channel } = require('../highscript/channel.js');
const { readLine } = require('../application/purchase.js');
const { lineOf } = require('../domain/orderAggregate.js');
const { parseLine } = require('../infrastructure/cli.js');
const { readText, parseSettings } = require('../infrastructure/config.js');
const server = require('../infrastructure/server.js');
const { reply, handleCall, open, Server } = server;

const silent = { log: async () => {}, error: async () => {} };

const capture = () => {
  const sent = { status: 0, type: '', body: '' };
  const response = {
    destroyed: false,
    writableEnded: false,
    writeHead(status, headers) {
      sent.status = status;
      sent.type = headers['content-type'];
    },
    end(body) {
      response.writableEnded = true;
      sent.body = body;
    },
  };
  return { response, sent };
};

const request = ({ method = 'POST', url = '/order', body = '' } = {}) => ({
  method,
  url,
  async *[Symbol.asyncIterator]() {
    if (body !== '') yield Buffer.from(body);
  },
});

test('readLine copies a known price and rejects a bad sku', async () => {
  const catalog = {
    find: async (sku) => (sku === 'book' ? { priceCents: 1500, sku } : null),
  };
  const line = { sku: 'book', quantity: 2 };
  const before = { ...line };
  assert.deepEqual(await readLine(line, catalog), {
    sku: 'book',
    quantity: 2,
    priceCents: 1500,
  });
  assert.deepEqual(line, before);
  for (const value of [null, {}, { sku: 1 }]) {
    await assert.rejects(readLine(value, catalog), /Expected SKU/);
  }
  await assert.rejects(readLine({ sku: 'pen', quantity: 1 }, catalog), {
    message: 'Unknown SKU: pen',
  });
});

test('lineOf checks sku, quantity, price and amount', () => {
  const item = { sku: 'book', quantity: 2, priceCents: 1500 };
  const before = { ...item };
  assert.deepEqual(lineOf(item), {
    sku: 'book',
    quantity: 2,
    priceCents: 1500,
    amountCents: 3000,
  });
  assert.deepEqual(item, before);
  const max = Number.MAX_SAFE_INTEGER;
  const edge = lineOf({ sku: 'book', quantity: max, priceCents: 1 });
  assert.equal(edge.amountCents, max);
  const cases = [
    {
      item: { sku: '', quantity: 1, priceCents: 1 },
      pattern: /Invalid or duplicate SKU/,
    },
    {
      item: { sku: 1, quantity: 1, priceCents: 1 },
      pattern: /Invalid or duplicate SKU/,
    },
    {
      item: { sku: 'book', quantity: 0, priceCents: 1 },
      pattern: /positive integer/,
    },
    {
      item: { sku: 'book', quantity: 1.5, priceCents: 1 },
      pattern: /positive integer/,
    },
    {
      item: { sku: 'book', quantity: 1, priceCents: -1 },
      pattern: /Invalid price/,
    },
    {
      item: { sku: 'book', quantity: 1, priceCents: 1.5 },
      pattern: /Invalid price/,
    },
    {
      item: { sku: 'book', quantity: max, priceCents: 2 },
      pattern: /Line amount overflow/,
    },
  ];
  for (const entry of cases) {
    assert.throws(() => lineOf(entry.item), entry.pattern);
  }
});

test('parseLine accepts sku and quantity tokens', () => {
  assert.deepEqual(parseLine('book:2'), { sku: 'book', quantity: 2 });
  assert.deepEqual(parseLine('a:1'), { sku: 'a', quantity: 1 });
  assert.deepEqual(parseLine('note-book:10'), {
    sku: 'note-book',
    quantity: 10,
  });
  for (const token of ['Book:2', 'book:0', 'book:01', '1book:1', 'book']) {
    assert.throws(() => parseLine(token), {
      message: `Invalid item: ${token}`,
    });
  }
});

test('readText reports a missing file and other errors', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'config-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fileName = path.join(root, 'settings.json');
  const raw = '{"log":"orders.log"}\n';
  await writeFile(fileName, raw);
  assert.equal(await readText(fileName), raw);
  const missing = path.join(root, 'missing.json');
  await assert.rejects(readText(missing), (error) => {
    assert.equal(error.message, `Configuration file not found: ${missing}`);
    assert.equal(error.cause.code, 'ENOENT');
    return true;
  });
  await assert.rejects(readText(root), (error) => error.code === 'EISDIR');
});

test('parseSettings accepts an object and rejects other input', () => {
  assert.deepEqual(parseSettings('{"server":{"port":3000}}'), {
    server: { port: 3000 },
  });
  const failure = { message: 'Invalid configuration' };
  for (const raw of ['[]', 'null', '1', '"text"', 'true']) {
    assert.throws(() => parseSettings(raw), failure);
  }
  assert.throws(
    () => parseSettings('{'),
    (error) => {
      assert.equal(error.message, 'Invalid configuration');
      assert.equal(error.cause instanceof SyntaxError, true);
      return true;
    },
  );
});

test('reply selects the content type and skips a finished response', () => {
  const ok = capture();
  reply(ok.response, 200, '{"ok":true}');
  assert.equal(ok.sent.status, 200);
  assert.equal(ok.sent.type, 'application/json');
  assert.equal(ok.sent.body, '{"ok":true}');
  reply(ok.response, 500, 'again');
  assert.equal(ok.sent.body, '{"ok":true}');
  const dead = capture();
  dead.response.destroyed = true;
  reply(dead.response, 500, 'gone');
  assert.equal(dead.sent.status, 0);
  const plain = capture();
  reply(plain.response, 404, 'Unknown command');
  assert.equal(plain.sent.type, 'text/plain');
  assert.equal(plain.sent.body, 'Unknown command');
});

test('handleCall routes commands and keeps error responses', async () => {
  const channel = new Channel();
  channel.on('call', {
    order: async (parameters) => ({ parameters }),
    fail: async () => {
      throw new Error('Invalid order');
    },
  });
  const call = async (fields) => {
    const captured = capture();
    await handleCall(channel, request(fields), captured.response);
    return captured.sent;
  };
  const success = await call({
    url: '/order?debug=1',
    body: '{"id":"ORDER-001"}',
  });
  assert.equal(success.status, 200);
  assert.equal(success.type, 'application/json');
  assert.deepEqual(JSON.parse(success.body), {
    parameters: { id: 'ORDER-001' },
  });
  const empty = await call({});
  assert.deepEqual(JSON.parse(empty.body), { parameters: null });
  const missing = await call({ url: '/missing', body: '{}' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body, 'Unknown command');
  assert.equal(missing.type, 'text/plain');
  const invalid = await call({ body: '{' });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body, /JSON/);
  const failed = await call({ url: '/fail', body: '{}' });
  assert.equal(failed.status, 400);
  assert.equal(failed.body, 'Invalid order');
  const unread = await call({ method: 'GET', body: '{' });
  assert.equal(unread.status, 404);
  assert.equal(unread.body, 'Unknown command');
  const root = await call({ url: '/', body: '{}' });
  assert.equal(root.status, 404);
});

test('handleCall leaves a non-json outcome to the caller', async () => {
  const channel = new Channel();
  channel.on('call', { broken: async () => 1n });
  const captured = capture();
  const fields = { url: '/broken', body: '{}' };
  await assert.rejects(
    handleCall(channel, request(fields), captured.response),
    TypeError,
  );
  assert.equal(captured.response.writableEnded, false);
});

test('server rejects a bad endpoint and a repeated close', async (context) => {
  const options = { host: '127.0.0.1', port: 0 };
  const badOptions = [
    { host: 1, port: 0 },
    { host: '127.0.0.1', port: 1.2 },
    { host: '127.0.0.1', port: -1 },
    { host: '127.0.0.1', port: 65536 },
  ];
  for (const value of badOptions) {
    assert.throws(
      () => new Server({ console: silent, options: value }),
      /Expected host and port/,
    );
  }
  const opened = open({ console: silent, options });
  context.after(() => opened.close());
  assert.equal(opened instanceof Server, true);
  for (const port of [0, 65535]) {
    const endpoint = new Server({
      console: silent,
      options: { host: '127.0.0.1', port },
    });
    const closing = endpoint.close();
    assert.equal(endpoint.close(), closing);
    await closing;
    await assert.rejects(endpoint.listen(), /Server is closed/);
  }
});
