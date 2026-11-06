'use strict';

// Runtime contracts: operation { input, output, errors }, interface of
// operations, versioned interface. Isomorphic (Node.js and browsers).

class ContractError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
    if (details) this.details = details;
  }
}

const createContracts = (specs, schemas) => {
  const cache = new Map();
  const get = (id) => {
    if (cache.has(id)) return cache.get(id);
    const spec = specs[id];
    if (!spec) throw new Error(`Unknown contract ${id}`);
    const contract = { id, kind: spec.kind, name: spec.name };
    cache.set(id, contract);
    if (spec.kind === 'operation') {
      for (const key of ['input', 'output', 'errors']) {
        contract[key] = spec[key] ? schemas.get(spec[key]) : null;
      }
      const code = contract.errors?.fields.code;
      contract.codes = code?.type === 'enum' ? new Set(code.values) : null;
    } else if (spec.kind === 'interface') {
      contract.version = spec.version;
      contract.operations = {};
      for (const [name, opId] of Object.entries(spec.operations)) {
        contract.operations[name] = get(opId);
      }
    } else {
      contract.versions = {};
      for (const [version, ifaceId] of Object.entries(spec.versions)) {
        contract.versions[version] = get(ifaceId);
      }
    }
    return Object.freeze(contract);
  };
  return { get };
};

const checkInput = (operation, input) => {
  if (!operation.input) return input;
  const { valid, errors } = operation.input.check(input);
  if (!valid) {
    throw new ContractError(
      'INVALID_INPUT',
      `${operation.name}: ${errors.join('; ')}`,
      errors,
    );
  }
  return input;
};

const checkOutput = (operation, output) => {
  if (!operation.output) return output;
  const projected = operation.output.project(output);
  const { valid, errors } = operation.output.check(projected);
  if (!valid) {
    throw new ContractError(
      'INVALID_OUTPUT',
      `${operation.name}: ${errors.join('; ')}`,
      errors,
    );
  }
  return projected;
};

const isDeclared = (operation, error) =>
  Boolean(error && operation.codes && operation.codes.has(error.code));

const guard = (operation, fn) => async (input) => {
  checkInput(operation, input);
  const output = await fn(input);
  return checkOutput(operation, output);
};

const latest = (contract) => {
  const versions = Object.keys(contract.versions);
  versions.sort((a, b) => a.slice(1) - b.slice(1));
  return contract.versions[versions[versions.length - 1]];
};

// Restricts a value to its contract: an operation guards a function,
// an interface keeps only declared operations and guards each one.
const restrict = (contract, value) => {
  if (contract.kind === 'operation') {
    if (typeof value !== 'function') {
      throw new Error(`${contract.name}: implementation must be a function`);
    }
    return guard(contract, value);
  }
  const iface = contract.kind === 'versioned' ? latest(contract) : contract;
  const api = {};
  for (const [name, operation] of Object.entries(iface.operations)) {
    const fn = value?.[name];
    if (typeof fn !== 'function') {
      throw new Error(`${contract.name}: missing ${name}`);
    }
    api[name] = guard(operation, fn.bind(value));
  }
  return Object.freeze(api);
};

// Client side of a remote binding: functions named after the contract,
// each validates the call and sends it through the `via` adapter.
const stub = ({ contract, name, version }, via) => {
  if (typeof via?.call !== 'function') {
    throw new Error(`${name}: via adapter must implement call(path, input)`);
  }
  const send = (operation, path) =>
    guard(operation, (input) => via.call(path, input));
  if (contract.kind === 'operation') return send(contract, name);
  const prefix = version ? `${name}/${version}` : name;
  const api = {};
  for (const [op, operation] of Object.entries(contract.operations)) {
    api[op] = send(operation, `${prefix}/${op}`);
  }
  return Object.freeze(api);
};

module.exports = {
  ContractError,
  createContracts,
  checkInput,
  checkOutput,
  isDeclared,
  restrict,
  stub,
};
