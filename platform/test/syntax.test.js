'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const syntax = require('../lib/syntax.js');
const { dslFiles } = require('../lib/convert.js');

const { parseSource, formatValue, convertValue, same } = syntax;

test('lisp and md entries: shorthand, value, empty object, nesting', () => {
  const js = parseSource(
    `({ exposes: { WebClient, ui: {}, api: PaymentService,
      open: { logger, port: 80, flags: [true, null, ['a']] } } });`,
    'js',
  );
  const lisp = parseSource(
    `; comment
    (exposes (WebClient) (ui {}) (api PaymentService)
      (open (logger) (port 80) (flags [true null ["a"]])))`,
    'lisp',
  );
  const md = parseSource(
    [
      '# Heading is ignored',
      '- exposes',
      '  - WebClient',
      '  - ui {}',
      '  - api PaymentService',
      '  - open',
      '    - logger',
      '    - port 80',
      '    - flags [true null ["a"]]',
    ].join('\n'),
    'md',
  );
  assert.ok(same(js, lisp));
  assert.ok(same(js, md));
});

test('strings with quotes and escapes survive every syntax', () => {
  const value = { text: `it's "quoted" \\ ; done\nnext`, empty: '' };
  for (const name of syntax.SYNTAXES) {
    assert.ok(same(parseSource(formatValue(value, name), name), value), name);
  }
});

test('ambiguous or unrepresentable forms are errors', () => {
  assert.throws(() => parseSource('(a 1 2)', 'lisp'), /use \[ \] for arrays/);
  assert.throws(() => parseSource('(a 1 (b))', 'lisp'), /Value and nested/);
  assert.throws(() => parseSource('- a\n   - b', 'md'), /Expected list item/);
  assert.throws(() => parseSource('- a.b 1', 'md'), /Expected entry name/);
  const quotedKey = parseSource(`({ 'content-type': 'json' });`, 'js');
  assert.throws(() => convertValue(quotedKey, 'lisp'), /Cannot represent/);
});

test('every DSL file of the example round-trips through all syntaxes', () => {
  const root = path.resolve(__dirname, '../../Enterprise');
  const files = dslFiles(root);
  assert.ok(files.length > 50);
  const used = new Set();
  for (const file of files) {
    const from = syntax.syntaxOf(file);
    used.add(from);
    const value = parseSource(fs.readFileSync(file, 'utf8'), from, file);
    for (const to of syntax.SYNTAXES) convertValue(value, to);
  }
  assert.deepEqual([...used].sort(), ['js', 'lisp', 'md']);
});
