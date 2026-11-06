'use strict';

// Metaschema-compatible subset: scalar fields, optional fields ('?string'),
// enum, array, references to other schemas, field and struct validators,
// Projection kind and index metadata. Works in Node.js and browsers.

const SCALARS = new Set(['string', 'number', 'boolean', 'object', 'any']);
const INDEX_KEYS = new Set(['primary', 'index', 'unique']);

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isFunctionSpec = (value) =>
  isObject(value) && Object.hasOwn(value, '$lib');

const checkScalar = (type, value) => {
  if (type === 'any') return true;
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (type === 'object') return isObject(value);
  return typeof value === type;
};

// Names of schemas a definition refers to as Metaschema strings: field
// shorthand ('Item', '?Item'), type, array and Projection.schema.
// A versioned name keeps its version: 'Payment.v2'.
const schemaRefs = (definition) => {
  const names = new Set();
  const add = (type) => {
    if (typeof type !== 'string') return;
    const name = type.replace(/^\?/, '');
    if (/^[A-Z]/.test(name)) names.add(name);
  };
  for (const [key, value] of Object.entries(definition)) {
    if (key === 'Projection') {
      add(value.schema);
    } else if (typeof value === 'string') {
      add(value);
    } else if (isObject(value)) {
      add(value.type);
      add(value.array);
    }
  }
  return names;
};

class Schema {
  #registry;
  #compiled = false;

  constructor({ id, name, definition, refs = {} }, registry) {
    this.id = id;
    this.name = name;
    this.definition = definition;
    this.refs = refs;
    this.#registry = registry;
    this.kind = 'struct';
    this.fields = {};
    this.metadata = { primary: null, unique: {}, index: {} };
    this.validators = [];
    this.ui = {};
    this.base = null;
  }

  #fail(message) {
    throw new Error(`Schema ${this.id}: ${message}`);
  }

  #ref(name) {
    const id = this.refs[name];
    if (!id) this.#fail(`unknown schema reference "${name}"`);
    return this.#registry.get(id);
  }

  #field(name, definition) {
    let def = definition;
    if (typeof def === 'string') def = { type: def };
    if (!isObject(def)) this.#fail(`invalid field "${name}"`);
    const field = { name, optional: def.required === false, ui: def.ui };
    let { type } = def;
    if (typeof type === 'string' && type.startsWith('?')) {
      field.optional = true;
      type = type.slice(1);
    }
    if (Array.isArray(def.enum)) {
      field.type = 'enum';
      field.values = def.enum;
    } else if (def.array !== undefined) {
      field.type = 'array';
      field.of = SCALARS.has(def.array) ? def.array : this.#ref(def.array);
    } else if (SCALARS.has(type)) {
      field.type = type;
    } else if (typeof type === 'string' && /^[A-Z]/.test(type)) {
      field.type = 'schema';
      field.schema = this.#ref(type);
    } else {
      this.#fail(`unknown type of field "${name}"`);
    }
    if (def.validate) field.validate = this.#registry.fn(def.validate);
    return field;
  }

  #metadata(name, value) {
    if (value.primary) this.metadata.primary = value.primary;
    if (value.unique) this.metadata.unique[name] = value.unique;
    if (value.index) this.metadata.index[name] = value.index;
  }

  compile() {
    if (this.#compiled) return this;
    this.#compiled = true;
    const { definition } = this;
    const projection = definition.Projection;
    if (projection) {
      this.kind = 'projection';
      this.base = this.#ref(projection.schema).compile();
      for (const name of projection.fields) {
        const field = this.base.fields[name];
        if (!field) this.#fail(`projected field "${name}" is not in base`);
        this.fields[name] = field;
      }
      this.ui = projection.ui || {};
    }
    for (const [name, value] of Object.entries(definition)) {
      if (name === 'Projection') continue;
      if (name === 'validate' && isFunctionSpec(value)) {
        this.validators.push(this.#registry.fn(value));
        continue;
      }
      const keys = isObject(value) ? Object.keys(value) : [];
      if (keys.length > 0 && keys.every((key) => INDEX_KEYS.has(key))) {
        this.#metadata(name, value);
        continue;
      }
      if (projection) this.#fail(`projection cannot add field "${name}"`);
      this.fields[name] = this.#field(name, value);
    }
    return this;
  }

  collect(value, path, errors) {
    this.compile();
    if (!isObject(value)) {
      errors.push(`${path || this.name}: expected object`);
      return;
    }
    const prefix = path ? `${path}.` : '';
    for (const key of Object.keys(value)) {
      if (!this.fields[key]) errors.push(`${prefix}${key}: unknown field`);
    }
    for (const field of Object.values(this.fields)) {
      checkValue(field, value[field.name], prefix + field.name, errors);
    }
    if (errors.length === 0) {
      for (const validate of this.validators) {
        if (!validate(value)) {
          errors.push(`${path || this.name}: invalid structure`);
        }
      }
    }
  }

  check(value) {
    const errors = [];
    this.collect(value, '', errors);
    return { valid: errors.length === 0, errors };
  }

  project(value) {
    this.compile();
    if (!isObject(value)) return value;
    const result = {};
    for (const field of Object.values(this.fields)) {
      const item = value[field.name];
      if (item === undefined) continue;
      if (field.type === 'schema') {
        result[field.name] = field.schema.project(item);
      } else if (
        field.type === 'array' &&
        field.of instanceof Schema &&
        Array.isArray(item)
      ) {
        result[field.name] = item.map((element) => field.of.project(element));
      } else {
        result[field.name] = item;
      }
    }
    return result;
  }
}

// Declared after Schema: uses it for nested schema checks.
function checkValue(field, value, path, errors) {
  if (value === undefined || value === null) {
    if (!field.optional) errors.push(`${path}: required`);
    return;
  }
  if (field.type === 'enum') {
    if (!field.values.includes(value)) {
      errors.push(`${path}: expected one of ${field.values.join(', ')}`);
      return;
    }
  } else if (field.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const itemPath = `${path}[${i}]`;
      if (field.of instanceof Schema) {
        field.of.compile().collect(item, itemPath, errors);
      } else if (!checkScalar(field.of, item)) {
        errors.push(`${itemPath}: expected ${field.of}`);
      }
    }
  } else if (field.type === 'schema') {
    field.schema.compile().collect(value, path, errors);
    return;
  } else if (!checkScalar(field.type, value)) {
    errors.push(`${path}: expected ${field.type}`);
    return;
  }
  if (field.validate && !field.validate(value)) {
    errors.push(`${path}: invalid value`);
  }
}

class SchemaRegistry {
  #specs = new Map();
  #schemas = new Map();
  #resolveFn;

  constructor(specs, resolveFn) {
    for (const spec of specs) this.#specs.set(spec.id, spec);
    this.#resolveFn = resolveFn;
  }

  get(id) {
    let schema = this.#schemas.get(id);
    if (schema) return schema;
    const spec = this.#specs.get(id);
    if (!spec) throw new Error(`Unknown schema ${id}`);
    schema = new Schema(spec, this);
    this.#schemas.set(id, schema);
    return schema.compile();
  }

  fn(spec) {
    const fn = this.#resolveFn(spec);
    if (typeof fn !== 'function') {
      throw new Error(`Validator ${spec.$lib} is not a function`);
    }
    return fn;
  }
}

module.exports = { SchemaRegistry, schemaRefs };
