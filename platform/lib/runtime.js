'use strict';

// Executes a plan: creates components in dependency order (each once),
// binds ports, wraps published operations with contracts, builds remote
// stubs, then starts and closes results. Isomorphic (Node.js and browsers).

const { SchemaRegistry } = require('./schema.js');
const { createContracts, restrict, stub } = require('./contracts.js');

const member = (value, path = []) => {
  let holder = null;
  let current = value;
  for (const key of path) {
    if (current === null || current === undefined) {
      throw new Error(`Cannot read "${key}" of ${current}`);
    }
    holder = current;
    current = current[key];
  }
  if (typeof current === 'function' && holder) return current.bind(holder);
  return current;
};

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};

class Assembly {
  #plan;
  #loadModule;
  #instances = new Map();
  #remotes = new Map();
  #created = [];
  #closed = false;

  constructor(plan, loadModule) {
    this.#plan = plan;
    this.#loadModule = loadModule;
    const resolveFn = (spec) => member(loadModule(spec.$lib), spec.path);
    this.schemas = new SchemaRegistry(Object.values(plan.schemas), resolveFn);
    this.contracts = createContracts(plan.contracts, this.schemas);
    this.roots = {};
  }

  get id() {
    return this.#plan.application;
  }

  node(id) {
    let promise = this.#instances.get(id);
    if (promise) return promise;
    promise = this.#create(id);
    this.#instances.set(id, promise);
    return promise;
  }

  async #create(id) {
    const spec = this.#plan.nodes[id];
    if (!spec) throw new Error(`Unknown component ${id}`);
    const ports = {};
    for (const [name, binding] of Object.entries(spec.ports)) {
      ports[name] = await this.value(binding);
    }
    const exports = this.#loadModule(spec.module);
    const factory = exports[spec.factory];
    if (typeof factory !== 'function') {
      throw new Error(`${id}: no factory ${spec.factory}`);
    }
    const instance = await factory(Object.freeze(ports));
    this.#created.push({ id, instance });
    return instance;
  }

  remote(id) {
    let promise = this.#remotes.get(id);
    if (promise) return promise;
    promise = (async () => {
      const spec = this.#plan.remotes[id];
      const via = await this.value(spec.via);
      const contract = this.contracts.get(spec.contract);
      return stub({ contract, name: spec.name, version: spec.version }, via);
    })();
    this.#remotes.set(id, promise);
    return promise;
  }

  async value(binding) {
    if ('node' in binding) return this.node(binding.node);
    if ('member' in binding) {
      return member(await this.value(binding.member), binding.path);
    }
    if ('object' in binding) {
      const object = {};
      for (const [key, item] of Object.entries(binding.object)) {
        object[key] = await this.value(item);
      }
      return Object.freeze(object);
    }
    if ('array' in binding) {
      const array = [];
      for (const item of binding.array) array.push(await this.value(item));
      return Object.freeze(array);
    }
    if ('value' in binding) return deepFreeze(structuredClone(binding.value));
    if ('schema' in binding) return this.schemas.get(binding.schema);
    if ('contract' in binding) return this.contracts.get(binding.contract);
    if ('lib' in binding) return this.#loadModule(binding.lib);
    if ('checked' in binding) {
      const contract = this.contracts.get(binding.checked);
      return restrict(contract, await this.value(binding.target));
    }
    if ('remote' in binding) return this.remote(binding.remote);
    throw new Error(`Unknown binding ${JSON.stringify(binding)}`);
  }

  async build() {
    try {
      for (const [name, binding] of Object.entries(this.#plan.roots)) {
        this.roots[name] = await this.value(binding);
      }
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
    return this;
  }

  async start() {
    try {
      for (const { instance } of this.#created) {
        if (instance && typeof instance.start === 'function') {
          await instance.start();
        }
      }
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    const errors = [];
    for (const { instance } of [...this.#created].reverse()) {
      if (!instance || typeof instance.close !== 'function') continue;
      try {
        await instance.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, `${this.id}: close failed`);
    }
  }
}

const createAssembly = (plan, { loadModule }) => new Assembly(plan, loadModule);

const assemble = (plan, options) => createAssembly(plan, options).build();

module.exports = { assemble, createAssembly };
