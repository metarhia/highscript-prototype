'use strict';

// Database driver stand-in: each collection is a JSON file on disk.
// Constraints come from record schemas: identity { primary } and { unique }
// metadata ({ index } is not built: queries scan the collection).
// Writes are serialized and atomic (tmp + rename).
// modify() runs read-check-write as one step, like UPDATE ... WHERE.

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

// Primary key value (single or composite) as one map key.
const idOf = (key) => [].concat(key).map(String).join('\u0000');

const keyOf = (fields, record) => idOf(fields.map((field) => record[field]));

const hasKey = (fields, record) =>
  fields.every(
    (field) => record[field] !== undefined && record[field] !== null,
  );

const matches = (record, filter) =>
  Object.entries(filter).every(([field, value]) => record[field] === value);

const copy = (record) => (record ? structuredClone(record) : null);

class Collection {
  #file;
  #schema;
  #primary;
  #records = new Map();
  #unique = new Map();
  #queue = Promise.resolve();

  constructor(file, schema) {
    this.#file = file;
    this.#schema = schema;
    this.#primary = schema.metadata.primary;
    if (!this.#primary) {
      throw new StoreError('SCHEMA', `${schema.name}: no primary key`);
    }
    for (const fields of Object.values(schema.metadata.unique)) {
      this.#unique.set(fields, new Map());
    }
  }

  get name() {
    return path.basename(this.#file, '.json');
  }

  async load() {
    let data = [];
    try {
      data = JSON.parse(await fs.readFile(this.#file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const record of data) this.#index(record);
    return this;
  }

  #index(record) {
    this.#records.set(keyOf(this.#primary, record), record);
    for (const [fields, map] of this.#unique) {
      if (hasKey(fields, record)) {
        map.set(keyOf(fields, record), keyOf(this.#primary, record));
      }
    }
  }

  #unindex(record) {
    for (const [fields, map] of this.#unique) {
      if (hasKey(fields, record)) map.delete(keyOf(fields, record));
    }
  }

  #validate(record, previousKey) {
    const { valid, errors } = this.#schema.check(record);
    if (!valid) {
      throw new StoreError('CONSTRAINT', `${this.name}: ${errors.join('; ')}`);
    }
    const key = keyOf(this.#primary, record);
    if (previousKey === null && this.#records.has(key)) {
      throw new StoreError(
        'UNIQUE_VIOLATION',
        `${this.name}: duplicate primary key`,
      );
    }
    for (const [fields, map] of this.#unique) {
      if (!hasKey(fields, record)) continue;
      const owner = map.get(keyOf(fields, record));
      if (owner !== undefined && owner !== previousKey) {
        throw new StoreError(
          'UNIQUE_VIOLATION',
          `${this.name}: duplicate ${fields.join(', ')}`,
        );
      }
    }
  }

  async #persist() {
    const data = JSON.stringify([...this.#records.values()], null, 2);
    const tmp = `${this.#file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${data}\n`);
    await fs.rename(tmp, this.#file);
  }

  #serialize(task) {
    const result = this.#queue.then(task);
    this.#queue = result.catch(() => {});
    return result;
  }

  insert(record) {
    return this.#serialize(async () => {
      const value = copy(record);
      this.#validate(value, null);
      this.#index(value);
      await this.#persist();
      return copy(value);
    });
  }

  // fn(current) returns changes or null to skip; returns updated or null.
  modify(key, fn) {
    return this.#serialize(async () => {
      const id = idOf(key);
      const current = this.#records.get(id);
      if (!current) return null;
      const changes = await fn(copy(current));
      if (!changes) return null;
      const next = { ...current, ...changes };
      this.#validate(next, id);
      if (keyOf(this.#primary, next) !== id) {
        throw new StoreError(
          'CONSTRAINT',
          `${this.name}: primary key is immutable`,
        );
      }
      this.#unindex(current);
      this.#index(next);
      await this.#persist();
      return copy(next);
    });
  }

  update(key, changes) {
    return this.modify(key, () => changes);
  }

  get(key) {
    return copy(this.#records.get(idOf(key)));
  }

  findOne(filter) {
    const fields = Object.keys(filter);
    for (const [unique, map] of this.#unique) {
      if (
        unique.length === fields.length &&
        unique.every((field) => fields.includes(field))
      ) {
        const id = map.get(keyOf(unique, filter));
        return id === undefined ? null : copy(this.#records.get(id));
      }
    }
    for (const record of this.#records.values()) {
      if (matches(record, filter)) return copy(record);
    }
    return null;
  }

  // Matching records in insertion order; only the page is copied.
  find(filter = {}, { offset = 0, limit = Infinity } = {}) {
    const result = [...this.#records.values()].filter((record) =>
      matches(record, filter),
    );
    return result.slice(offset, offset + limit).map(copy);
  }

  count(filter = {}) {
    let total = 0;
    for (const record of this.#records.values()) {
      if (matches(record, filter)) total++;
    }
    return total;
  }

  flush() {
    return this.#queue;
  }
}

const openStore = async ({ directory, logger }) => {
  if (typeof directory !== 'string' || directory === '') {
    throw new StoreError('CONFIG', 'Expected directory');
  }
  const dir = path.resolve(directory);
  await fs.mkdir(dir, { recursive: true });
  const collections = new Map();
  logger?.info(`json store at ${path.relative(process.cwd(), dir) || '.'}`);

  // Caches the loading promise: concurrent calls share one instance.
  const collection = (name, schema) => {
    let found = collections.get(name);
    if (!found) {
      const file = path.join(dir, `${name}.json`);
      found = new Collection(file, schema).load();
      collections.set(name, found);
    }
    return found;
  };

  const close = async () => {
    const loaded = await Promise.all(collections.values());
    await Promise.all(loaded.map((item) => item.flush()));
  };

  return Object.freeze({
    collection,
    newId: () => randomUUID(),
    close,
    directory: dir,
  });
};

module.exports = { openStore, StoreError };
