'use strict';

// Scaffolding: from DSL files to project structure and module templates.
// Every DSL reference is checked; what is missing becomes a unit folder with
// a level file, a component module template or a configuration section.
// Existing files are never changed. New files can add new references, so
// the analysis repeats until nothing is missing.

const fs = require('node:fs');
const path = require('node:path');
const {
  loadModel,
  findRoot,
  where,
  descendants,
  commonUnit,
  LEVELS,
  LEVEL_FILES,
  APPLICATION_RANK,
} = require('./loader.js');
const {
  Resolver,
  findLexical,
  lookup,
  isOperation,
  pickFactory,
  ENTRY_META,
} = require('./planner.js');
const { ModuleLoader, signature } = require('./modules.js');
const { Ref, isRef, isPlainObject, refsOf } = require('./parser.js');
const { schemaRefs } = require('./schema.js');
const { formatValue, syntaxOf } = require('./syntax.js');

const MAX_PASSES = 8;
const LOCK = '.highscript-scaffold.lock';
// Marker of unimplemented templates; the architecture check looks for it.
const NOT_IMPLEMENTED = 'Not implemented';

const isPascal = (name) => /^[A-Z]/.test(name);

// Collects what the DSL needs and the model does not have.
class Analysis {
  constructor(model, { env, loader = new ModuleLoader() } = {}) {
    this.model = model;
    this.resolver = new Resolver(model, env);
    this.loader = loader;
    this.units = new Map();
    this.components = new Map();
    this.sections = new Map();
    this.definitions = new Map();
    this.warnings = new Set();
  }

  needUnit(parent, name) {
    const key = `${parent.id}.${name}`;
    if (!this.units.has(key)) {
      this.units.set(key, { parent, name, members: new Map() });
    }
    return this.units.get(key);
  }

  needComponent(unit, name, info = {}) {
    const key = `${unit.id}.${name}`;
    const need = this.components.get(key) || { unit, name, members: new Set() };
    this.components.set(key, Object.assign(need, info));
    return need;
  }

  needSection(app, name, value = {}) {
    if (!app || app.config?.base.has(name)) return;
    const key = `${app.id}#${name}`;
    const known = this.sections.get(key);
    if (!known || Object.keys(known.value).length === 0) {
      this.sections.set(key, { app, name, value });
    }
  }

  namespace(unit, [ns, name]) {
    if (!name) return;
    if (ns === 'config') {
      if (!unit.application) {
        this.warnings.add(`${unit.id}: config.${name} outside application`);
      } else {
        this.needSection(unit.application, name);
      }
      return;
    }
    if (findLexical(unit, ns, name)) return;
    const key = `${ns}.${name}`;
    const need = this.definitions.get(key) || { ns, name, units: [] };
    need.units.push(unit);
    this.definitions.set(key, need);
  }

  // A reference in the inner scope of unit, by the resolver's scope rules.
  use(unit, ref) {
    const [head, member] = ref.path;
    let target;
    try {
      target = lookup(unit, head);
    } catch (error) {
      return void this.warnings.add(error.message);
    }
    if (target?.kind === 'namespace') {
      return void this.namespace(unit, ref.path);
    }
    if (target?.kind === 'unit') {
      const child = target.unit;
      if (member && !Object.hasOwn(child.dsl.exposes, member)) {
        this.warnings.add(
          `${child.id} does not expose "${member}" used as "${ref}"`,
        );
      }
      return;
    }
    if (target) return;
    if (unit.rank < APPLICATION_RANK || isPascal(head)) {
      const need = this.needUnit(unit, head);
      if (member && !need.members.has(member)) need.members.set(member, null);
      return;
    }
    const need = this.needComponent(unit, head);
    if (member) need.members.add(member);
  }

  useValue(unit, value) {
    for (const ref of refsOf(value)) this.use(unit, ref);
  }

  entry(unit, name, value) {
    if (isRef(value)) return void this.use(unit, value);
    if (!isPlainObject(value)) return;
    const [factory = null] = Object.keys(value).filter(
      (key) => !ENTRY_META.has(key),
    );
    const ports =
      factory && isPlainObject(value[factory]) ? value[factory] : {};
    if (value.contract) this.use(unit, value.contract);
    this.useValue(unit, ports);
    this.implementers(unit, value.contract, ports);
    if (unit.children.has(name)) return;
    if (unit.rank < APPLICATION_RANK) return void this.needUnit(unit, name);
    const { contract = null, transport = null } = value;
    const need = { factory, ports: Object.keys(ports), contract, transport };
    this.needComponent(unit, name, need);
    const options = ports.options;
    if (
      transport === 'http-json' &&
      isRef(options) &&
      options.head === 'config'
    ) {
      const host = { host: '127.0.0.1', port: 8080, basePath: '/api' };
      this.needSection(unit.application, options.path[1], host);
    }
  }

  // A new unit passed to an entry with an interface contract (api: Orders)
  // exposes the operations of that interface with their contracts.
  implementers(unit, contract, ports) {
    const shape = contract && this.contractShape({ contract, unit });
    if (shape?.kind !== 'interface') return;
    for (const value of Object.values(ports)) {
      if (!isRef(value) || value.path.length !== 1) continue;
      if (unit.children.has(value.head) || !isPascal(value.head)) continue;
      const need = this.needUnit(unit, value.head);
      for (const operation of shape.operations) {
        const path = [...shape.path, operation];
        need.members.set(operation, new Ref(path));
      }
    }
  }

  // Transport of the endpoint behind `from`, http-json when unknown.
  transportOf(ref, scope) {
    try {
      return (
        this.resolver.endpoint(ref, scope, 'scaffold').transport || 'http-json'
      );
    } catch {
      return 'http-json';
    }
  }

  consumed(unit, name, value) {
    const { parent } = unit;
    if (isRef(value)) return void (parent && this.use(parent, value));
    if (!isPlainObject(value)) return;
    if (value.from && parent) this.use(parent, value.from);
    if (value.contract) this.use(unit, value.contract);
    if (!isRef(value.via)) return;
    const { head } = value.via;
    if (unit.children.has(head) || Object.hasOwn(unit.dsl.consumes, head)) {
      return;
    }
    const transport = value.from
      ? this.transportOf(value.from, parent)
      : 'http-json';
    this.needComponent(unit, head, { role: 'via', transport });
  }

  // By-name ports of an existing component: `options` and sibling names.
  existing(component) {
    const { unit, name } = component;
    const entry = unit.dsl.exposes[name];
    if (
      isPlainObject(entry) &&
      Object.keys(entry).some((key) => !ENTRY_META.has(key))
    ) {
      return;
    }
    let exports;
    try {
      exports = this.loader.load(component.file, component.boundary);
    } catch (error) {
      return void this.warnings.add(`${component.id}: ${error.message}`);
    }
    let factory;
    try {
      factory = exports[pickFactory(exports, component.id)];
    } catch {
      return; // reported by the architecture check
    }
    for (const port of signature(factory) || []) {
      if (port === 'options') this.needSection(unit.application, name);
      else if (!ENTRY_META.has(port)) this.use(unit, new Ref([port]));
    }
  }

  // References inside contracts and schemas: namespaces and type strings.
  definition(unit, value, kind) {
    for (const ref of refsOf(value)) {
      if (
        ref.head === 'contracts' ||
        ref.head === 'schemas' ||
        ref.head === 'lib'
      ) {
        this.namespace(unit, ref.path);
      } else {
        this.warnings.add(`${unit.id}.${kind}: "${ref}" is not a definition`);
      }
    }
    if (kind !== 'schemas') return;
    for (const name of schemaRefs(value)) {
      this.namespace(unit, ['schemas', name.split('.')[0]]);
    }
  }

  run(root) {
    for (const unit of descendants(root)) {
      for (const kind of ['contracts', 'schemas']) {
        for (const def of unit[kind].values()) {
          const items = def.versions ? [...def.versions.values()] : [def];
          for (const item of items) this.definition(unit, item.value, kind);
        }
      }
      for (const [name, value] of Object.entries(unit.dsl.exposes)) {
        this.entry(unit, name, value);
      }
      for (const [name, value] of Object.entries(unit.dsl.consumes)) {
        this.consumed(unit, name, value);
      }
      for (const child of unit.children.values()) {
        if (child.kind === 'component') this.existing(child);
      }
    }
    for (const { ns, name, units } of this.definitions.values()) {
      const owner = commonUnit(units);
      this.warnings.add(
        `${ns}.${name} is not defined: ` +
          `add it to ${where(owner.dir)}/${ns}/ ` +
          '(lowest unit enclosing its users)',
      );
    }
    return this;
  }

  // Operation or interface behind a contract reference, if resolvable.
  contractShape(need) {
    if (!need.contract) return null;
    try {
      const { def, version, operation } = this.resolver.resolve(
        need.contract,
        need.unit,
      );
      const latest = def.versions ? [...def.versions.keys()].at(-1) : null;
      const item = def.versions ? def.versions.get(version || latest) : def;
      const value = operation ? item.value[operation] : item.value;
      if (isOperation(value) || isRef(value)) {
        const describe = (key) =>
          isRef(value?.[key]) ? value[key].path.slice(1).join('.') : '-';
        const text = isRef(value)
          ? String(value)
          : `${describe('input')} -> ${describe('output')}`;
        return { kind: 'operation', text };
      }
      const base = need.contract.path.slice(0, operation ? -1 : undefined);
      const pinned = def.versions && !version ? [...base, latest] : base;
      return {
        kind: 'interface',
        operations: Object.keys(value),
        path: pinned,
      };
    } catch {
      return null;
    }
  }
}

// Module templates

const moduleText = (factory, ports, body, header = []) => {
  const params = ports.length ? `{ ${ports.join(', ')} }` : '';
  return [
    `'use strict';`,
    '',
    ...header,
    ...header.slice(0, 1).map(() => ''),
    `const ${factory} = (${params}) =>${body}`,
    '',
    `module.exports = { ${factory} };`,
    '',
  ].join('\n');
};

const notImplemented = (id) => `throw new Error('${NOT_IMPLEMENTED}: ${id}');`;

const methods = (names, id) =>
  names
    .map(
      (name) =>
        `  ${name}: async () => {\n` +
        `    ${notImplemented(`${id}.${name}`)}\n  },`,
    )
    .join('\n');

const componentTemplate = (need, analysis) => {
  const id = `${need.unit.id}.${need.name}`;
  const ports = need.ports || [];
  const factory = need.factory || (need.transport ? 'open' : 'create');
  if (need.transport === 'http-json' && ports.includes('api')) {
    const args = ['options', 'logger', 'api'].filter((port) =>
      ports.includes(port),
    );
    return moduleText(
      factory,
      [...ports, 'contract'],
      `\n  createServer({ ${[...args, 'contract'].join(', ')} });`,
      [`const { createServer } = require('highscript/http-server');`],
    );
  }
  if (need.role === 'via' && need.transport === 'http-json') {
    analysis.needSection(need.unit.application, need.name, {
      url: 'http://127.0.0.1:8080/api',
      timeoutMs: 10000,
    });
    return moduleText(factory, ['options'], ' createClient(options);', [
      `const { createClient } = require('highscript/http-client');`,
    ]);
  }
  if (need.role === 'via') {
    return moduleText(
      factory,
      ports,
      ` ({\n  call: async () => {\n    ${notImplemented(id)}\n  },\n});`,
    );
  }
  if (need.transport) {
    const close = '  close: async () => {},';
    const body = ` ({\n${methods(['start'], id)}\n${close}\n});`;
    return moduleText(factory, ports, body, [
      `// Endpoint with transport '${need.transport}'.`,
    ]);
  }
  if (!need.factory && need.name === 'logger') {
    analysis.needSection(need.unit.application, 'logger', {
      name: need.unit.application.name,
      level: 'info',
    });
    return moduleText('open', ['options'], ' openLogger(options);', [
      `const { openLogger } = require('highscript/logger');`,
    ]);
  }
  if (!need.factory && need.name === 'database') {
    const directory = `.data/development/${need.unit.application.name}`;
    analysis.needSection(need.unit.application, 'database', { directory });
    return moduleText(
      'open',
      ['options', 'logger'],
      '\n  openStore({ directory: options.directory, logger });',
      [
        '// Database driver: JSON files stand in for a real database.',
        `const { openStore } = require('highscript/json-store');`,
      ],
    );
  }
  const shape = analysis.contractShape(need);
  const names =
    shape?.kind === 'interface' ? shape.operations : [...need.members];
  if (names.length > 0) {
    return moduleText(factory, ports, ` ({\n${methods(names, id)}\n});`);
  }
  const header = shape ? [`// ${need.name}: ${shape.text}`] : [];
  return moduleText(
    factory,
    ports,
    ` async () => {\n  ${notImplemented(id)}\n};`,
    header,
  );
};

const unitTemplate = (need, syntax) => {
  const rank = Math.min(need.parent.rank + 1, LEVELS.length - 1);
  const { names } = LEVELS[rank];
  const exposes = {};
  if (rank >= APPLICATION_RANK) {
    for (const [member, contract] of need.members) {
      exposes[member] = contract ? { contract } : {};
    }
  }
  return {
    file: path.join(need.parent.dir, need.name, `${names[0]}.${syntax}`),
    text: formatValue({ consumes: {}, exposes }, syntax),
    rank,
  };
};

const levelSyntax = (unit) => syntaxOf(path.basename(unit.file)) || 'js';

// Writes files that do not exist yet; returns created paths.
const writeNew = (files, dry) => {
  const created = [];
  for (const { file, text } of files) {
    if (fs.existsSync(file)) continue;
    created.push(where(file));
    if (dry) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { flag: 'wx' });
  }
  return created;
};

// Files the DSL of a unit tree needs and the model does not have yet.
const missing = (model, unit, options) => {
  const analysis = new Analysis(model, options).run(unit);
  const files = [];
  for (const need of analysis.units.values()) {
    const syntax = levelSyntax(need.parent);
    const { file, text, rank } = unitTemplate(need, syntax);
    files.push({ file, text });
    if (rank < APPLICATION_RANK && need.members.size > 0) {
      const members = [...need.members.keys()].join(', ');
      analysis.warnings.add(
        `${need.parent.id}.${need.name} must expose: ${members}`,
      );
    }
  }
  for (const need of analysis.components.values()) {
    const text = componentTemplate(need, analysis);
    files.push({ file: path.join(need.unit.dir, `${need.name}.js`), text });
  }
  for (const { app, name, value } of analysis.sections.values()) {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    files.push({ file: path.join(app.dir, 'config', `${name}.json`), text });
  }
  return { files, warnings: analysis.warnings };
};

// What scaffolding would create for an already loaded model (no writes).
const planned = (model, options = {}) =>
  writeNew(missing(model, model.root, options).files, true);

const pass = (root, { env, dry }) => {
  const model = loadModel(root);
  const unit = model.findUnit(root) || model.root;
  const { files, warnings } = missing(model, unit, { env });
  return { model, created: writeNew(files, dry), warnings };
};

// options: { env, dry }. A dry run writes nothing, not even the lock.
// The report keeps the last loaded model (non-enumerable) when the last
// pass created nothing, so a following check can reuse it.
const scaffold = (target, options = {}) => {
  const root = path.resolve(target);
  const lock = path.join(findRoot(root), LOCK);
  let handle = null;
  if (!options.dry) {
    try {
      handle = fs.openSync(lock, 'wx');
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error('Scaffolding is already running');
      }
      throw error;
    }
  }
  const report = { created: [], warnings: [] };
  try {
    const warnings = new Set();
    for (let i = 0; i < MAX_PASSES; i++) {
      const result = pass(root, options);
      report.created.push(...result.created);
      for (const warning of result.warnings) warnings.add(warning);
      const done = result.created.length === 0;
      if (done) Object.defineProperty(report, 'model', { value: result.model });
      if (done || options.dry) break;
    }
    report.warnings.push(...warnings);
  } finally {
    if (handle !== null) {
      fs.closeSync(handle);
      fs.rmSync(lock, { force: true });
    }
  }
  return report;
};

// New unit folder with a starter level file.
const init = (dir, { level = 'solution', syntax = 'js' } = {}) => {
  const rank = LEVELS.findIndex((item) => item.level === level);
  if (rank === -1) throw new Error(`Unknown level ${level}`);
  const target = path.resolve(dir);
  if (
    fs.existsSync(target) &&
    fs.readdirSync(target).some((name) => LEVEL_FILES.has(name))
  ) {
    throw new Error(`${where(target)} already has a level file`);
  }
  const value =
    rank < APPLICATION_RANK
      ? { actors: {}, consumes: {}, exposes: {} }
      : { consumes: {}, exposes: {} };
  const file = path.join(target, `${LEVELS[rank].names[0]}.${syntax}`);
  return writeNew([{ file, text: formatValue(value, syntax) }], false);
};

module.exports = { scaffold, planned, init, NOT_IMPLEMENTED };
