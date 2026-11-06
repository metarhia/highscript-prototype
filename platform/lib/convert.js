'use strict';

// Converts DSL files (level files, contracts, schemas) between js, lisp and
// md. Each file is verified by a round trip before it replaces the original.

const fs = require('node:fs');
const path = require('node:path');
const { LEVEL_FILES, readDir, isUnit, baseName } = require('./loader.js');
const { syntaxOf, parseSource, convertValue } = require('./syntax.js');

const DEFINITIONS = new Set(['contracts', 'schemas']);

const definitionFiles = (dir) =>
  readDir(dir).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return definitionFiles(full);
    return syntaxOf(entry.name) ? [full] : [];
  });

// DSL files of a unit and of its nested units.
const dslFiles = (dir) => {
  const files = [];
  for (const entry of readDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && LEVEL_FILES.has(entry.name)) files.push(full);
    if (!entry.isDirectory()) continue;
    if (DEFINITIONS.has(entry.name)) files.push(...definitionFiles(full));
    else if (isUnit(full)) files.push(...dslFiles(full));
  }
  return files;
};

// Text of a DSL file in another syntax (verified by a round trip).
const print = (file, to) => {
  const text = fs.readFileSync(file, 'utf8');
  return convertValue(parseSource(text, syntaxOf(file), file), to);
};

// target: a DSL file or a unit folder. Returns [{ from, to }].
const convert = (target, { to, dry = false }) => {
  const stat = fs.statSync(target);
  const files = stat.isDirectory() ? dslFiles(target) : [target];
  const changes = [];
  for (const file of files) {
    const from = syntaxOf(file);
    if (!from) throw new Error(`${file}: not a DSL file`);
    if (from === to) continue;
    const text = print(file, to);
    const destination = `${baseName(file)}.${to}`;
    if (fs.existsSync(destination)) throw new Error(`${destination} exists`);
    changes.push({ from: file, to: destination, text });
  }
  if (!dry) {
    for (const { from, to: destination, text } of changes) {
      fs.writeFileSync(destination, text);
      fs.rmSync(from);
    }
  }
  return changes.map(({ from, to: destination }) => ({
    from,
    to: destination,
  }));
};

module.exports = { convert, print, dslFiles };
