'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isPlainObject } = require('./parser.js');
const { SYNTAXES, syntaxOf, parseSource } = require('./syntax.js');

const LEVELS = [
  { level: 'enterprise', names: ['enterprise', 'landscape'] },
  { level: 'solution', names: ['solution', 'system'] },
  { level: 'application', names: ['application', 'subsystem'] },
  { level: 'service', names: ['service', 'module'] },
  { level: 'component', names: ['component'] },
];
// Level file in any syntax: application.js, application.lisp, application.md
const LEVEL_NAMES = new Set(LEVELS.flatMap(({ names }) => names));
const LEVEL_FILES = new Map(
  LEVELS.flatMap(({ level, names }, rank) =>
    names.flatMap((name) =>
      SYNTAXES.map((syntax) => [`${name}.${syntax}`, { level, rank }]),
    ),
  ),
);
const baseName = (file) => file.slice(0, file.lastIndexOf('.'));
const APPLICATION_RANK = 2;
const RESERVED = new Set([
  'config',
  'contracts',
  'schemas',
  'lib',
  'test',
  'docs',
]);
const SECTIONS = new Set(['actors', 'consumes', 'exposes']);
const VERSION = /^v\d+$/;
const isIgnored = (name) => name.startsWith('.') || name === 'node_modules';

// One finding of a check: severity, stable code, location and message.
class Diagnostic {
  constructor(severity, code, where, message) {
    this.severity = severity;
    this.code = code;
    this.where = where;
    this.message = message;
  }

  toString() {
    return this.where ? `${this.where}: ${this.message}` : this.message;
  }
}

class Diagnostics {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.hints = [];
  }

  error(code, where, message) {
    this.errors.push(new Diagnostic('error', code, where, message));
  }

  warning(code, where, message) {
    this.warnings.push(new Diagnostic('warning', code, where, message));
  }

  hint(code, where, message) {
    this.hints.push(new Diagnostic('hint', code, where, message));
  }

  merge(other) {
    this.errors.push(...other.errors);
    this.warnings.push(...other.warnings);
    this.hints.push(...other.hints);
    return this;
  }
}

const readDir = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !isIgnored(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

const levelFiles = (entries) =>
  entries
    .filter((entry) => entry.isFile() && LEVEL_FILES.has(entry.name))
    .map((entry) => entry.name);

const isUnit = (dir) => {
  try {
    return levelFiles(readDir(dir)).length > 0;
  } catch {
    return false;
  }
};

const where = (file) => path.relative(process.cwd(), file) || '.';

const byVersion = (a, b) => a.slice(1) - b.slice(1);

// Unit tree helpers.
const descendants = (unit) => [
  unit,
  ...[...unit.children.values()]
    .filter((child) => child.kind === 'unit')
    .flatMap(descendants),
];

const ancestors = (unit) => {
  const chain = [];
  for (let current = unit; current; current = current.parent) {
    chain.unshift(current);
  }
  return chain;
};

// Lowest unit enclosing all given units.
const commonUnit = (units) => {
  const chains = units.map(ancestors);
  let common = null;
  for (let i = 0; chains.every((chain) => chain[i] === chains[0][i]); i++) {
    if (!chains[0][i]) break;
    common = chains[0][i];
  }
  return common;
};

const findRoot = (start) => {
  let dir = path.resolve(start);
  if (!isUnit(dir)) {
    throw new Error(`${start} is not an architectural unit (no level file)`);
  }
  while (isUnit(path.dirname(dir))) dir = path.dirname(dir);
  return dir;
};

class Loader {
  constructor() {
    this.diagnostics = new Diagnostics();
    this.units = new Map();
  }

  parseFile(file) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      return parseSource(text, syntaxOf(file), where(file));
    } catch (error) {
      this.diagnostics.error('SYNTAX', null, error.message);
      return null;
    }
  }

  loadDefinitions(unit, kind, dir) {
    const definitions = new Map();
    const define = (name, definition, file) => {
      if (definitions.has(name)) {
        const message = `${kind}.${name} is defined twice`;
        this.diagnostics.error('DUPLICATE', where(file), message);
      }
      definitions.set(name, definition);
    };
    for (const entry of readDir(dir)) {
      const file = path.join(dir, entry.name);
      if (entry.isFile() && syntaxOf(entry.name)) {
        const name = baseName(entry.name);
        const id = `${unit.id}.${kind}.${name}`;
        const value = this.parseFile(file);
        define(name, { kind, id, name, unit, file, value }, file);
        continue;
      }
      if (!entry.isDirectory()) {
        this.diagnostics.error(
          'UNEXPECTED_FILE',
          where(file),
          'unexpected file',
        );
        continue;
      }
      const id = `${unit.id}.${kind}.${entry.name}`;
      const versions = new Map();
      const items = readDir(file).sort((a, b) =>
        byVersion(baseName(a.name), baseName(b.name)),
      );
      for (const item of items) {
        const version = baseName(item.name);
        const itemFile = path.join(file, item.name);
        const valid = item.isFile() && syntaxOf(item.name);
        if (!valid || !VERSION.test(version) || versions.has(version)) {
          const message = versions.has(version)
            ? `version ${version} is defined twice`
            : 'expected version file vN.js, vN.lisp or vN.md';
          this.diagnostics.error('VERSION_FILE', where(itemFile), message);
          continue;
        }
        const value = this.parseFile(itemFile);
        versions.set(version, {
          kind,
          id: `${id}.${version}`,
          name: entry.name,
          version,
          unit,
          file: itemFile,
          value,
        });
      }
      define(entry.name, { kind, id, name: entry.name, unit, versions }, file);
    }
    return definitions;
  }

  // Base sections and environment folders: Map<section, value> each.
  loadConfig(dir) {
    const base = new Map();
    const environments = new Map();
    const readSection = (sections, file, name) => {
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        sections.set(name.slice(0, -5), value);
      } catch (error) {
        this.diagnostics.error('CONFIG_FILE', where(file), error.message);
      }
    };
    for (const entry of readDir(dir)) {
      const file = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.json')) {
        readSection(base, file, entry.name);
        continue;
      }
      if (!entry.isDirectory()) {
        const message = 'unexpected config entry';
        this.diagnostics.error('UNEXPECTED_FILE', where(file), message);
        continue;
      }
      const sections = new Map();
      environments.set(entry.name, sections);
      for (const item of readDir(file)) {
        const itemFile = path.join(file, item.name);
        if (item.isFile() && item.name.endsWith('.json')) {
          readSection(sections, itemFile, item.name);
        } else {
          const message = 'unexpected config entry';
          this.diagnostics.error('UNEXPECTED_FILE', where(itemFile), message);
        }
      }
    }
    return { base, environments };
  }

  loadUnit(dir, parent, entries = readDir(dir)) {
    const files = levelFiles(entries);
    const name = path.basename(dir);
    if (files.length > 1) {
      const message = `several level files: ${files.join(', ')}`;
      this.diagnostics.error('LEVEL_FILE', where(dir), message);
    }
    const fileName = files[0];
    const { level, rank } = LEVEL_FILES.get(fileName);
    const id = parent ? `${parent.id}.${name}` : name;
    const file = path.join(dir, fileName);
    const unit = {
      kind: 'unit',
      id,
      name,
      level,
      rank,
      dir,
      file,
      parent,
      dsl: { actors: {}, consumes: {}, exposes: {} },
      children: new Map(),
      contracts: new Map(),
      schemas: new Map(),
      lib: new Map(),
      config: null,
      application: null,
    };
    unit.application =
      rank === APPLICATION_RANK ? unit : parent?.application || null;
    this.units.set(id, unit);
    if (parent) {
      const nested = rank > parent.rank || (rank === 4 && parent.rank === 4);
      if (!nested) {
        const message = `${level} cannot be inside ${parent.level}`;
        this.diagnostics.error('NESTING', where(dir), message);
      }
    }
    const dsl = this.parseFile(file);
    if (dsl) {
      for (const [key, value] of Object.entries(dsl)) {
        if (!SECTIONS.has(key)) {
          const message = `unknown section "${key}"`;
          this.diagnostics.error('SECTION', where(file), message);
        } else if (!isPlainObject(value)) {
          const message = `section "${key}" must be an object`;
          this.diagnostics.error('SECTION', where(file), message);
        } else {
          unit.dsl[key] = value;
        }
      }
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        if (LEVEL_FILES.has(entry.name)) continue;
        if (entry.name.endsWith('.js')) {
          this.addComponent(unit, entry.name.slice(0, -3), full, full);
        } else if (entry.name.endsWith('.lisp')) {
          const message = 'lisp file is not a level file';
          this.diagnostics.warning('UNEXPECTED_FILE', where(full), message);
        }
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (entry.name === 'config') {
        if (rank !== APPLICATION_RANK) {
          const message = 'config/ is allowed only in application';
          this.diagnostics.error('CONFIG_PLACE', where(full), message);
        }
        unit.config = this.loadConfig(full);
      } else if (entry.name === 'contracts' || entry.name === 'schemas') {
        unit[entry.name] = this.loadDefinitions(unit, entry.name, full);
      } else if (entry.name === 'lib') {
        for (const item of readDir(full)) {
          if (!item.isFile() || !item.name.endsWith('.js')) continue;
          const libName = item.name.slice(0, -3);
          const libFile = path.join(full, item.name);
          unit.lib.set(libName, {
            id: `${id}.lib.${libName}`,
            file: libFile,
            boundary: full,
          });
        }
      } else if (entry.name !== 'test' && entry.name !== 'docs') {
        this.addFolder(unit, entry.name, full);
      }
    }
    return unit;
  }

  addFolder(unit, name, full) {
    const entries = readDir(full);
    if (levelFiles(entries).length > 0) {
      this.addChild(unit, name, this.loadUnit(full, unit, entries), full);
    } else if (entries.some((entry) => entry.name === `${name}.js`)) {
      this.addComponent(unit, name, path.join(full, `${name}.js`), full);
    } else {
      const message =
        'folder is neither a unit (no level file) ' +
        'nor a component (no same-named .js)';
      this.diagnostics.error('FOLDER', where(full), message);
    }
  }

  addChild(unit, name, child, location) {
    if (RESERVED.has(name) || LEVEL_NAMES.has(name)) {
      const message = `reserved name "${name}"`;
      this.diagnostics.error('RESERVED_NAME', where(location), message);
    }
    if (unit.children.has(name)) {
      const message = `duplicate child "${name}"`;
      this.diagnostics.error('DUPLICATE', where(location), message);
    }
    unit.children.set(name, child);
  }

  addComponent(unit, name, file, boundary) {
    if (unit.rank < APPLICATION_RANK) {
      const message = `code is not allowed in ${unit.level}`;
      this.diagnostics.error('CODE_PLACE', where(file), message);
    }
    const component = {
      kind: 'component',
      id: `${unit.id}.${name}`,
      name,
      unit,
      file,
      boundary,
    };
    this.addChild(unit, name, component, file);
  }
}

const loadModel = (start) => {
  const rootDir = findRoot(start);
  const loader = new Loader();
  const root = loader.loadUnit(rootDir, null);
  const findUnit = (dir) => {
    const relative = path.relative(rootDir, path.resolve(dir));
    const id = [root.id, ...relative.split(path.sep).filter(Boolean)].join('.');
    return loader.units.get(id) || null;
  };
  return {
    root,
    rootDir,
    units: loader.units,
    diagnostics: loader.diagnostics,
    findUnit,
  };
};

module.exports = {
  loadModel,
  findRoot,
  isUnit,
  where,
  readDir,
  baseName,
  byVersion,
  descendants,
  ancestors,
  commonUnit,
  Diagnostics,
  APPLICATION_RANK,
  VERSION,
  LEVELS,
  LEVEL_FILES,
};
