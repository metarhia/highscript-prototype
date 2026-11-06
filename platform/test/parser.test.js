'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parse, isRef } = require('../lib/parser.js');

test('references, shorthand, literals and comments', () => {
  const value = parse(`({
    // comment
    exposes: { WebClient, server: { contract: contracts.Payments, port: 80 } },
    flags: [true, null, -1.5, 'a.b'], /* block */
  });`);
  assert.ok(isRef(value.exposes.WebClient));
  assert.deepEqual(value.exposes.WebClient.path, ['WebClient']);
  assert.deepEqual(value.exposes.server.contract.path, [
    'contracts',
    'Payments',
  ]);
  assert.deepEqual(value.flags, [true, null, -1.5, 'a.b']);
});

test('rejects calls, duplicates and trailing code', () => {
  assert.throws(() => parse('({ a: b.c() });'), /Calls are not supported/);
  assert.throws(() => parse('({ a: 1, a: 2 });'), /Duplicate key "a"/);
  assert.throws(() => parse('({}); x'), /Unexpected content/);
  assert.throws(() => parse('{ a: 1 }'), /Expected "\("/);
});
