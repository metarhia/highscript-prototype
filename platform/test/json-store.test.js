'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { openStore } = require('../adapters/json-store.js');
const { SchemaRegistry } = require('../lib/schema.js');

const schema = new SchemaRegistry(
  [
    {
      id: 'Row',
      name: 'Row',
      definition: {
        id: 'string',
        key: 'string',
        count: 'number',
        identity: { primary: ['id'] },
        byKey: { unique: ['key'] },
      },
    },
  ],
  () => null,
).get('Row');

test('constraints, atomic modify and persistence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const store = await openStore({ directory });
  const rows = await store.collection('rows', schema);
  await rows.insert({ id: '1', key: 'a', count: 0 });
  await assert.rejects(rows.insert({ id: '1', key: 'b', count: 0 }), {
    code: 'UNIQUE_VIOLATION',
  });
  await assert.rejects(rows.insert({ id: '2', key: 'a', count: 0 }), {
    code: 'UNIQUE_VIOLATION',
  });
  await assert.rejects(rows.insert({ id: '3', key: 'c' }), {
    code: 'CONSTRAINT',
  });
  const increments = Array.from({ length: 10 }, () =>
    rows.modify('1', (current) => ({ count: current.count + 1 })),
  );
  await Promise.all(increments);
  assert.equal(rows.get('1').count, 10);
  assert.equal(rows.findOne({ key: 'a' }).id, '1');
  assert.equal(await rows.modify('1', () => null), null);
  await store.close();
  const reopened = await (
    await openStore({ directory })
  ).collection('rows', schema);
  assert.equal(reopened.get('1').count, 10);
  fs.rmSync(directory, { recursive: true, force: true });
});
