'use strict';

const { Ref, isRef, isPlainObject } = require('./parser.js');
const { ModuleLoader, signature } = require('./modules.js');
const {
  Diagnostics,
  APPLICATION_RANK,
  VERSION,
  descendants,
} = require('./loader.js');
const { schemaRefs } = require('./schema.js');

const NAMESPACES = new Set(['contracts', 'schemas', 'lib', 'config']);
const ENTRY_META = new Set(['contract', 'transport']);
const OPERATION_KEYS = new Set(['input', 'output', 'errors']);

class PlanError extends Error {
  constructor(message, code = 'PLAN') {
    super(message);
    this.code = code;
  }
}

const deepMerge = (base, override) => {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge(base[key], value);
  }
  return result;
};

const pick = (value, path, where) => {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) {
      throw new PlanError(`${where}: no "${path.join('.')}"`, 'CONFIG');
    }
    current = current[key];
  }
  return current;
};

const isOperation = (value) => {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => OPERATION_KEYS.has(key));
};

const lookup = (unit, name) => {
  const consumed = Object.hasOwn(unit.dsl.consumes, name);
  const child = unit.children.get(name);
  if (consumed && child) {
    throw new PlanError(
      `${unit.id}: "${name}" is both consumed and a child`,
      'AMBIGUOUS',
    );
  }
  if (consumed) return { kind: 'consumed', unit, name, path: [] };
  if (child?.kind === 'unit') return { kind: 'unit', unit: child };
  if (child) return { kind: 'component', component: child, path: [] };
  if (NAMESPACES.has(name)) return { kind: 'namespace', ns: name, unit };
  return null;
};

const findLexical = (unit, ns, name) => {
  for (let current = unit; current; current = current.parent) {
    const found = current[ns].get(name);
    if (found) return found;
  }
  return null;
};

const pickFactory = (exports, id) => {
  const factories = Object.keys(exports).filter(
    (key) => typeof exports[key] === 'function',
  );
  if (factories.length === 1) return factories[0];
  throw new PlanError(
    `${id}: expected one factory export, found ${factories.length}`,
    'FACTORY',
  );
};

// Resolves references according to scope rules:
// - inner scope of a unit: its consumes keys, children and namespaces;
// - consumes values and `from` resolve in the parent's inner scope;
// - entering a unit `X.y` is possible only through X.exposes.
class Resolver {
  #entries = new Map();
  #configs = new Map();

  // overrides: { [applicationId]: { [section]: value } }, merged last.
  constructor(model, env, overrides = {}) {
    this.model = model;
    this.env = env;
    this.overrides = overrides;
    // What resolution touched: `${unit.id}#${name}` of consumes keys and
    // exposes entries, `${app.id}#${section}` of config sections.
    this.used = {
      consumes: new Set(),
      entries: new Set(),
      sections: new Set(),
    };
  }

  resolve(ref, unit) {
    const target = lookup(unit, ref.head);
    if (target?.kind === 'consumed') {
      this.used.consumes.add(`${unit.id}#${ref.head}`);
    }
    if (!target) {
      throw new PlanError(`${unit.id}: unresolved name "${ref}"`, 'UNRESOLVED');
    }
    return this.walk(target, ref.path.slice(1), ref);
  }

  walk(target, rest, ref) {
    if (target.kind === 'namespace') return this.namespace(target, rest, ref);
    if (rest.length === 0) return target;
    const [name, ...tail] = rest;
    if (target.kind === 'unit') {
      const { unit } = target;
      if (!Object.hasOwn(unit.dsl.exposes, name)) {
        throw new PlanError(
          `"${ref}": "${name}" is private in ${unit.id}`,
          'PRIVATE',
        );
      }
      this.used.entries.add(`${unit.id}#${name}`);
      return this.walk(
        { kind: 'entry', unit, name, version: null, path: [] },
        tail,
        ref,
      );
    }
    if (target.kind === 'entry') {
      const info = this.entry(target.unit, target.name);
      if (info.publishes) return this.walk(info.publishes, rest, ref);
      if (info.contract?.def.versions && VERSION.test(name)) {
        if (!info.contract.def.versions.has(name)) {
          throw new PlanError(`"${ref}": unknown version ${name}`, 'VERSION');
        }
        return this.walk({ ...target, version: name }, tail, ref);
      }
    }
    return { ...target, path: [...target.path, ...rest] };
  }

  config(app) {
    let sections = this.#configs.get(app.id);
    if (sections) return sections;
    sections = new Map();
    const layers = [
      app.config?.base,
      app.config?.environments.get(this.env),
      Object.entries(this.overrides[app.id] || {}),
    ];
    for (const layer of layers) {
      for (const [name, value] of layer || []) {
        sections.set(name, deepMerge(sections.get(name), value));
      }
    }
    this.#configs.set(app.id, sections);
    return sections;
  }

  // config: the whole section map, a section or a value inside it.
  configOf(unit, rest, ref) {
    const app = unit.application;
    if (!app) {
      throw new PlanError(
        `"${ref}": config is available only in applications`,
        'CONFIG',
      );
    }
    const sections = this.config(app);
    const [name, ...tail] = rest;
    const used = name ? [name] : [...sections.keys()];
    for (const section of used) this.used.sections.add(`${app.id}#${section}`);
    if (!name) return { kind: 'config', value: Object.fromEntries(sections) };
    if (!sections.has(name)) {
      throw new PlanError(
        `${app.id}: no config section "${name}" (env ${this.env})`,
        'CONFIG',
      );
    }
    return {
      kind: 'config',
      value: pick(sections.get(name), tail, `config.${name}`),
    };
  }

  namespace({ ns, unit }, rest, ref) {
    if (ns === 'config') return this.configOf(unit, rest, ref);
    if (rest.length === 0) return { kind: 'namespace', ns, unit };
    const [name, ...tail] = rest;
    const def = findLexical(unit, ns, name);
    if (!def) {
      throw new PlanError(`${unit.id}: unresolved "${ref}"`, 'UNRESOLVED');
    }
    if (ns === 'lib') return { kind: 'lib', lib: def, path: tail };
    let version = null;
    let path = tail;
    if (def.versions && VERSION.test(path[0])) {
      version = path[0];
      if (!def.versions.has(version)) {
        throw new PlanError(`"${ref}": unknown version`, 'VERSION');
      }
      path = path.slice(1);
    }
    if (ns === 'schemas') {
      if (path.length > 0) {
        throw new PlanError(`"${ref}": schema has no members`, 'REFERENCE');
      }
      if (def.versions && !version) {
        throw new PlanError(
          `"${ref}": schema is versioned, select a version`,
          'VERSION',
        );
      }
      return { kind: 'schema', def, version };
    }
    if (path.length > 1) throw new PlanError(`"${ref}": too deep`, 'REFERENCE');
    return { kind: 'contract', def, version, operation: path[0] ?? null };
  }

  entry(unit, name) {
    const key = `${unit.id}#${name}`;
    let info = this.#entries.get(key);
    if (info) return info;
    const value = unit.dsl.exposes[name];
    const where = `${unit.id}.exposes.${name}`;
    if (isRef(value)) {
      info = { publishes: this.resolve(value, unit) };
    } else if (isPlainObject(value)) {
      const factories = Object.keys(value).filter(
        (key) => !ENTRY_META.has(key),
      );
      if (factories.length > 1) {
        throw new PlanError(`${where}: several factory maps`, 'ENTRY');
      }
      const contract = value.contract
        ? this.resolve(value.contract, unit)
        : null;
      if (contract && contract.kind !== 'contract') {
        throw new PlanError(
          `${where}: contract must reference contracts`,
          'CONTRACT',
        );
      }
      const child = unit.children.get(name);
      if (!child) {
        throw new PlanError(
          `${where}: component "${name}" is not implemented`,
          'MISSING',
        );
      }
      info = {
        contract,
        transport: value.transport ?? null,
        factory: factories[0] ?? null,
        ports: factories[0] ? value[factories[0]] : null,
      };
      if (child.kind === 'unit') {
        if (info.factory) {
          throw new PlanError(`${where}: a unit has no factory`, 'ENTRY');
        }
        info.publishes = { kind: 'unit', unit: child };
      } else {
        info.component = child;
      }
      if (info.ports !== null && !isPlainObject(info.ports)) {
        throw new PlanError(
          `${where}: factory ports must be an object`,
          'ENTRY',
        );
      }
    } else {
      throw new PlanError(`${where}: expected reference or object`, 'ENTRY');
    }
    this.#entries.set(key, info);
    return info;
  }

  entryFor(component) {
    const { unit, name } = component;
    if (!Object.hasOwn(unit.dsl.exposes, name)) return null;
    const info = this.entry(unit, name);
    return info.component === component ? info : null;
  }

  // Meaning of a consumes entry: { ref } takes a name from the parent's
  // scope; otherwise { contract, via } where contract is the contract target
  // of the endpoint (`from`) or of the requirement (`contract`).
  consumption(unit, name) {
    const value = unit.dsl.consumes[name];
    const at = `${unit.id}.consumes.${name}`;
    if (isRef(value)) {
      if (!unit.parent) {
        throw new PlanError(
          `${at}: root consumes must declare a contract`,
          'CONSUMES',
        );
      }
      return { ref: value, at };
    }
    if (!isPlainObject(value) || (!value.from && !value.contract)) {
      throw new PlanError(
        `${at}: expected a reference, from or contract`,
        'CONSUMES',
      );
    }
    let contract;
    if (value.from) {
      contract = this.endpoint(value.from, unit.parent, at);
    } else {
      contract = this.resolve(value.contract, unit);
      if (contract.kind !== 'contract') {
        throw new PlanError(`${at}: expected contract`, 'CONTRACT');
      }
    }
    return { contract, via: value.via ?? null, at };
  }

  // Contract target behind a `from` reference: an exposed entry with
  // contract (version selected by `.vN`), followed through re-exports and
  // consumes entries of enclosing units.
  endpoint(ref, unit, where) {
    if (!unit) {
      throw new PlanError(
        `${where}: "${ref}" has no enclosing scope`,
        'ENDPOINT',
      );
    }
    return this.endpointOf(this.resolve(ref, unit), ref, where);
  }

  endpointOf(target, ref, where) {
    if (target.kind === 'consumed') {
      const consumed = this.consumption(target.unit, target.name);
      const contract = consumed.ref
        ? this.endpoint(consumed.ref, target.unit.parent, consumed.at)
        : consumed.contract;
      const [version] = target.path;
      return VERSION.test(version) ? { ...contract, version } : contract;
    }
    if (target.kind === 'entry') {
      const info = this.entry(target.unit, target.name);
      if (info.publishes && target.path.length === 0) {
        return this.endpointOf(info.publishes, ref, where);
      }
      if (info.contract) {
        return {
          ...info.contract,
          version: target.version ?? info.contract.version,
          transport: info.transport,
        };
      }
    }
    throw new PlanError(`${where}: "${ref}" is not an endpoint`, 'ENDPOINT');
  }
}

const withPath = (binding, path) => {
  if (!path || path.length === 0) return binding;
  return { member: binding, path };
};

class Planner {
  constructor(resolver, app, loader = new ModuleLoader()) {
    this.resolver = resolver;
    this.app = app;
    this.loader = loader;
    this.planning = new Set();
    this.plan = {
      application: app.id,
      env: resolver.env,
      modules: {},
      schemas: {},
      contracts: {},
      nodes: {},
      remotes: {},
      roots: {},
    };
  }

  // errors: an array to collect one error per root and continue;
  // without it the first error is thrown.
  build(errors = null) {
    for (const name of Object.keys(this.app.dsl.exposes)) {
      try {
        this.plan.roots[name] = this.bindEntry(this.app, name);
      } catch (error) {
        if (!errors) throw error;
        this.planning.clear();
        errors.push(error);
      }
    }
    return this.plan;
  }

  libId(lib) {
    this.plan.modules[lib.id] = { file: lib.file, boundary: lib.boundary };
    return lib.id;
  }

  convert(value, unit) {
    if (isRef(value)) {
      const target = this.resolver.resolve(value, unit);
      if (target.kind !== 'lib') {
        throw new PlanError(`${unit.id}: "${value}" must be lib`, 'REFERENCE');
      }
      return { $lib: this.libId(target.lib), path: target.path };
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.convert(item, unit));
    }
    if (isPlainObject(value)) {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = this.convert(item, unit);
      }
      return result;
    }
    return value;
  }

  schemaId({ def, version }) {
    const item = def.versions ? def.versions.get(version) : def;
    if (this.plan.schemas[item.id]) return item.id;
    const spec = { id: item.id, name: def.name, definition: null, refs: {} };
    this.plan.schemas[item.id] = spec;
    spec.definition = this.convert(item.value, def.unit);
    for (const name of schemaRefs(item.value)) {
      const [base, itemVersion = null] = name.split('.');
      const found = findLexical(def.unit, 'schemas', base);
      if (!found) {
        throw new PlanError(
          `${item.id}: unknown schema "${name}"`,
          'UNRESOLVED',
        );
      }
      spec.refs[name] = this.schemaId({ def: found, version: itemVersion });
    }
    return item.id;
  }

  operationId(id, name, value, unit) {
    if (this.plan.contracts[id]) return id;
    const spec = { kind: 'operation', name };
    this.plan.contracts[id] = spec;
    for (const key of OPERATION_KEYS) {
      if (!value[key]) continue;
      const target = this.resolver.resolve(value[key], unit);
      if (target.kind !== 'schema') {
        throw new PlanError(`${id}.${key}: expected schema`, 'CONTRACT');
      }
      spec[key] = this.schemaId(target);
    }
    return id;
  }

  interfaceId(item, name, version) {
    if (this.plan.contracts[item.id]) return item.id;
    const spec = { kind: 'interface', name, version, operations: {} };
    this.plan.contracts[item.id] = spec;
    for (const [op, value] of Object.entries(item.value)) {
      if (isRef(value)) {
        const target = this.resolver.resolve(value, item.unit);
        if (target.kind !== 'contract' || !target.operation) {
          throw new PlanError(
            `${item.id}.${op}: expected operation contract`,
            'CONTRACT',
          );
        }
        spec.operations[op] = this.contractId(target);
      } else if (isOperation(value)) {
        spec.operations[op] = this.operationId(
          `${item.id}.${op}`,
          op,
          value,
          item.unit,
        );
      } else {
        throw new PlanError(`${item.id}.${op}: expected operation`, 'CONTRACT');
      }
    }
    return item.id;
  }

  contractId({ def, version, operation }) {
    if (def.versions && !version) {
      if (operation) {
        throw new PlanError(
          `${def.id}.${operation}: select a version`,
          'VERSION',
        );
      }
      if (!this.plan.contracts[def.id]) {
        const versions = {};
        this.plan.contracts[def.id] = {
          kind: 'versioned',
          name: def.name,
          versions,
        };
        for (const [key, item] of def.versions) {
          versions[key] = this.interfaceId(item, def.name, key);
        }
      }
      return def.id;
    }
    const item = def.versions ? def.versions.get(version) : def;
    if (isOperation(item.value)) {
      if (operation) {
        throw new PlanError(`${item.id}: is an operation`, 'CONTRACT');
      }
      return this.operationId(item.id, def.name, item.value, def.unit);
    }
    const id = this.interfaceId(item, def.name, version);
    if (!operation) return id;
    const opId = this.plan.contracts[id].operations[operation];
    if (!opId) {
      throw new PlanError(`${id}: no operation "${operation}"`, 'CONTRACT');
    }
    return opId;
  }

  planNode(component) {
    const { id, unit } = component;
    if (this.plan.nodes[id]) return id;
    if (this.planning.has(id)) {
      throw new PlanError(`construction cycle at ${id}`, 'CYCLE');
    }
    if (unit.application !== this.app) {
      throw new PlanError(
        `${this.app.id} references ${id} of another application; ` +
          'use consumes with from/via',
        'CROSS_APPLICATION',
      );
    }
    this.planning.add(id);
    const info = this.resolver.entryFor(component);
    const exports = this.loader.load(component.file, component.boundary);
    const factory = info?.factory || pickFactory(exports, id);
    if (typeof exports[factory] !== 'function') {
      throw new PlanError(
        `${id}: module has no factory "${factory}"`,
        'FACTORY',
      );
    }
    const params = signature(exports[factory]);
    const ports = {};
    if (info?.ports) {
      for (const [port, value] of Object.entries(info.ports)) {
        ports[port] = this.bindValue(value, unit);
      }
      for (const name of params ?? []) {
        const port = ports[name] ? null : this.entryPort(name, info);
        if (port) ports[name] = port;
      }
      if (params) {
        const given = Object.keys(ports);
        const missing = params.filter((name) => !given.includes(name));
        const extra = given.filter((name) => !params.includes(name));
        if (missing.length || extra.length) {
          throw new PlanError(
            `${id}: factory ${factory}({ ${params.join(', ')} }) ` +
              'does not match ports ' +
              `{ ${given.join(', ')} }`,
            'SIGNATURE',
          );
        }
      }
    } else if (params) {
      for (const name of params) {
        ports[name] = this.bindName(name, component, info);
      }
    }
    this.plan.modules[id] = {
      file: component.file,
      boundary: component.boundary,
    };
    this.plan.nodes[id] = { module: id, factory, ports };
    this.planning.delete(id);
    return id;
  }

  // Ports a factory gets from its exposes entry without listing them.
  entryPort(name, info) {
    if (name === 'contract' && info?.contract) {
      return { contract: this.contractId(info.contract) };
    }
    if (name === 'transport' && info?.transport) {
      return { value: info.transport };
    }
    return null;
  }

  // By-name port: `options` is config.<component name>, the rest are names
  // in the component's unit scope.
  bindName(name, component, info) {
    const { unit } = component;
    if (name === 'options') {
      return this.bindRef(new Ref(['config', component.name]), unit);
    }
    return this.entryPort(name, info) ?? this.bindRef(new Ref([name]), unit);
  }

  // Contract of a remote binding; a versioned contract must be pinned.
  remoteContract(contract, where) {
    const { def, version } = contract;
    if (def.versions && !version) {
      throw new PlanError(
        `${where}: ${def.name} is versioned, pin a version in from`,
        'VERSION',
      );
    }
    return this.contractId(contract);
  }

  bindValue(value, unit) {
    if (isRef(value)) return this.bindRef(value, unit);
    if (Array.isArray(value)) {
      return { array: value.map((item) => this.bindValue(item, unit)) };
    }
    if (isPlainObject(value)) {
      const object = {};
      for (const [key, item] of Object.entries(value)) {
        object[key] = this.bindValue(item, unit);
      }
      return { object };
    }
    return { value };
  }

  bindRef(ref, unit) {
    return this.bindTarget(this.resolver.resolve(ref, unit));
  }

  bindTarget(target) {
    switch (target.kind) {
      case 'component':
        return withPath({ node: this.planNode(target.component) }, target.path);
      case 'unit':
        return this.bindUnit(target.unit);
      case 'entry':
        return withPath(this.bindEntry(target.unit, target.name), target.path);
      case 'consumed':
        return withPath(
          this.bindConsumed(target.unit, target.name),
          target.path,
        );
      case 'contract':
        return { contract: this.contractId(target) };
      case 'schema':
        return { schema: this.schemaId(target) };
      case 'lib':
        return withPath({ lib: this.libId(target.lib) }, target.path);
      case 'config':
        return { value: target.value };
      case 'namespace':
        return this.bindNamespace(target);
      default:
        throw new PlanError(`unsupported target ${target.kind}`, 'PLAN');
    }
  }

  bindNamespace({ ns, unit }) {
    const object = {};
    for (let current = unit; current; current = current.parent) {
      for (const [name, def] of current[ns]) {
        if (object[name]) continue;
        if (ns === 'lib') {
          object[name] = { lib: this.libId(def) };
        } else if (ns === 'contracts') {
          object[name] = { contract: this.contractId({ def }) };
        } else if (def.versions) {
          const versions = {};
          for (const version of def.versions.keys()) {
            versions[version] = { schema: this.schemaId({ def, version }) };
          }
          object[name] = { object: versions };
        } else {
          object[name] = { schema: this.schemaId({ def, version: null }) };
        }
      }
    }
    return { object };
  }

  bindUnit(unit) {
    const object = {};
    for (const name of Object.keys(unit.dsl.exposes)) {
      this.resolver.used.entries.add(`${unit.id}#${name}`);
      object[name] = this.bindEntry(unit, name);
    }
    return { object };
  }

  bindEntry(unit, name) {
    const info = this.resolver.entry(unit, name);
    if (info.publishes) return this.bindTarget(info.publishes);
    const node = { node: this.planNode(info.component) };
    if (info.contract && !info.transport) {
      return { checked: this.contractId(info.contract), target: node };
    }
    return node;
  }

  bindConsumed(unit, name) {
    const key = `${unit.id}.consumes.${name}`;
    if (this.plan.remotes[key]) return { remote: key };
    const consumed = this.resolver.consumption(unit, name);
    if (consumed.ref) return this.bindRef(consumed.ref, unit.parent);
    if (!consumed.via) {
      throw new PlanError(
        `${key}: remote dependency needs via in an application`,
        'REMOTE',
      );
    }
    const { def, version } = consumed.contract;
    const spec = { contract: null, name: def.name, version, via: null };
    this.plan.remotes[key] = spec;
    spec.contract = this.remoteContract(consumed.contract, key);
    spec.via = this.bindRef(consumed.via, unit);
    return { remote: key };
  }
}

const applications = (unit) =>
  descendants(unit).filter((item) => item.rank === APPLICATION_RANK);

const hasCode = (app) =>
  descendants(app).some((unit) =>
    [...unit.children.values()].some((child) => child.kind === 'component'),
  );

const planApplication = (model, app, { env }) => {
  const resolver = new Resolver(model, env);
  return new Planner(resolver, app).build();
};

const codeOf = (error) => error.code || 'CODE';

// Model check: structure, shadowing, references of every level and a plan
// of every application. Returns diagnostics, the resolver with its usage
// records and the plans of applications planned without errors.
const analyzeModel = (model, { env }) => {
  const diagnostics = new Diagnostics().merge(model.diagnostics);
  const resolver = new Resolver(model, env);
  const plans = new Map();
  for (const unit of model.units.values()) {
    for (const ns of ['contracts', 'schemas', 'lib']) {
      for (const name of unit[ns].keys()) {
        if (unit.parent && findLexical(unit.parent, ns, name)) {
          const message = `${ns}.${name} shadows an enclosing definition`;
          diagnostics.error('SHADOWING', unit.id, message);
        }
      }
    }
    for (const [actor, value] of Object.entries(unit.dsl.actors)) {
      const used = isPlainObject(value?.consumes)
        ? Object.values(value.consumes)
        : [];
      for (const ref of used) {
        const valid = isRef(ref) && ref.path.length === 1;
        if (!valid || !Object.hasOwn(unit.dsl.exposes, ref.head)) {
          const message = `actor ${actor} consumes unexposed "${ref}"`;
          diagnostics.error('ACTOR', unit.id, message);
        }
      }
    }
    if (unit.rank >= APPLICATION_RANK) continue;
    const checks = [
      ...Object.keys(unit.dsl.consumes).map((name) => () => {
        const consumed = resolver.consumption(unit, name);
        if (consumed.ref) resolver.resolve(consumed.ref, unit.parent);
      }),
      ...Object.keys(unit.dsl.exposes).map(
        (name) => () => resolver.entry(unit, name),
      ),
    ];
    for (const check of checks) {
      try {
        check();
      } catch (error) {
        diagnostics.error(codeOf(error), unit.id, error.message);
      }
    }
  }
  // Usage only: consumes of applications resolve without code, so design-only
  // applications still mark what their parents provide.
  for (const app of applications(model.root)) {
    for (const name of Object.keys(app.dsl.consumes)) {
      try {
        const consumed = resolver.consumption(app, name);
        if (consumed.ref) resolver.resolve(consumed.ref, app.parent);
      } catch {
        // reported by planning
      }
    }
  }
  // One module loader: every component module is executed once per check.
  const loader = new ModuleLoader();
  for (const app of applications(model.root)) {
    const design = !hasCode(app);
    const errors = [];
    const plan = new Planner(resolver, app, loader).build(errors);
    if (errors.length === 0) plans.set(app.id, plan);
    if (design) {
      const reason = errors.length ? `: ${errors[0].message}` : ' (no code)';
      diagnostics.warning(
        'DESIGN_ONLY',
        app.id,
        `design-only application${reason}`,
      );
      continue;
    }
    for (const error of errors) {
      diagnostics.error(codeOf(error), app.id, error.message);
    }
  }
  return { diagnostics, resolver, plans, loader };
};

module.exports = {
  planApplication,
  analyzeModel,
  applications,
  hasCode,
  Resolver,
  Planner,
  PlanError,
  findLexical,
  lookup,
  isOperation,
  pickFactory,
  NAMESPACES,
  ENTRY_META,
  OPERATION_KEYS,
};
