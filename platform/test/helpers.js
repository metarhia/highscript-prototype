'use strict';

// Fixture models for platform tests, removed when the test process exits.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'highscript-test-'));
process.on('exit', () => fs.rmSync(base, { recursive: true, force: true }));

let count = 0;

// Writes { 'path/file': text } into a new folder `name`; returns its path.
const writeTree = (files, name = 'Root') => {
  const root = path.join(base, String(++count), name);
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return root;
};

// Component module with one factory.
const factory = (name, ports, body = '({})') =>
  `'use strict';\nconst ${name} = (${ports}) => ${body};\n` +
  `module.exports = { ${name} };\n`;

module.exports = { writeTree, factory };
