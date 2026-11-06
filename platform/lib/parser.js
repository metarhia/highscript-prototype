'use strict';

// DSL source is one parenthesized object literal: `({ ... });`
// Identifiers and identifier chains are references, everything else is data.
// The parser never evaluates the source.

class Ref {
  constructor(path, loc) {
    this.path = path;
    this.loc = loc;
  }

  get head() {
    return this.path[0];
  }

  toString() {
    return this.path.join('.');
  }
}

class SyntaxFailure extends Error {
  constructor(message, file, loc) {
    const where = loc ? `${file}:${loc.line}:${loc.column}` : file;
    super(`${where}: ${message}`);
    this.code = 'DSL_SYNTAX';
    this.file = file;
    this.loc = loc;
  }
}

const QUOTES = new Set(['\u0027', '"']);
const PUNCTUATION = new Set(['{', '}', '[', ']', '(', ')', ',', ':', ';', '.']);
const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPES = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  0: '\0',
};

const tokenize = (source, file) => {
  const tokens = [];
  let line = 1;
  let lineStart = 0;
  let i = 0;
  const loc = () => ({ line, column: i - lineStart + 1 });
  const fail = (message) => {
    throw new SyntaxFailure(message, file, loc());
  };
  while (i < source.length) {
    const char = source[i];
    if (char === '\n') {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) fail('Unterminated comment');
      for (let j = i; j < end; j++) {
        if (source[j] === '\n') {
          line++;
          lineStart = j + 1;
        }
      }
      i = end + 2;
      continue;
    }
    if (QUOTES.has(char)) {
      const start = loc();
      let value = '';
      i++;
      while (source[i] !== char) {
        if (i >= source.length || source[i] === '\n') {
          fail('Unterminated string');
        }
        if (source[i] === '\\') {
          const next = source[i + 1];
          if (next === 'u') {
            value += String.fromCharCode(
              parseInt(source.slice(i + 2, i + 6), 16),
            );
            i += 6;
            continue;
          }
          value += ESCAPES[next] ?? next;
          i += 2;
          continue;
        }
        value += source[i++];
      }
      i++;
      tokens.push({ type: 'string', value, loc: start });
      continue;
    }
    NUMBER.lastIndex = i;
    const number = NUMBER.exec(source);
    if (number && (char === '-' || /\d/.test(char))) {
      tokens.push({ type: 'number', value: Number(number[0]), loc: loc() });
      i += number[0].length;
      continue;
    }
    IDENTIFIER.lastIndex = i;
    const identifier = IDENTIFIER.exec(source);
    if (identifier) {
      tokens.push({ type: 'name', value: identifier[0], loc: loc() });
      i += identifier[0].length;
      continue;
    }
    if (PUNCTUATION.has(char)) {
      tokens.push({ type: char, loc: loc() });
      i++;
      continue;
    }
    fail(`Unexpected character "${char}"`);
  }
  tokens.push({ type: 'end', loc: loc() });
  return tokens;
};

const LITERALS = { true: true, false: false, null: null };

const parse = (source, file = '<dsl>') => {
  const tokens = tokenize(source, file);
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const fail = (message, token = peek()) => {
    throw new SyntaxFailure(message, file, token.loc);
  };
  const expect = (type) => {
    const token = next();
    if (token.type !== type) {
      const found = token.value ?? token.type;
      fail(`Expected "${type}" but found "${found}"`, token);
    }
    return token;
  };

  const parseReference = (first) => {
    const path = [first.value];
    while (peek().type === '.') {
      next();
      const part = next();
      if (part.type !== 'name') fail('Expected identifier after "."', part);
      path.push(part.value);
    }
    if (peek().type === '(') fail('Calls are not supported in DSL');
    return new Ref(path, first.loc);
  };

  const parseObject = () => {
    expect('{');
    const object = {};
    while (peek().type !== '}') {
      const key = next();
      if (!['name', 'string', 'number'].includes(key.type)) {
        fail('Expected property name', key);
      }
      const name = String(key.value);
      if (Object.hasOwn(object, name)) fail(`Duplicate key "${name}"`, key);
      if (peek().type === ':') {
        next();
        object[name] = parseValue();
      } else if (key.type === 'name') {
        object[name] = new Ref([name], key.loc);
      } else {
        fail('Expected ":"', key);
      }
      if (peek().type !== ',') break;
      next();
    }
    expect('}');
    return object;
  };

  const parseArray = () => {
    expect('[');
    const array = [];
    while (peek().type !== ']') {
      array.push(parseValue());
      if (peek().type !== ',') break;
      next();
    }
    expect(']');
    return array;
  };

  function parseValue() {
    const token = peek();
    if (token.type === '{') return parseObject();
    if (token.type === '[') return parseArray();
    next();
    if (token.type === 'string' || token.type === 'number') return token.value;
    if (token.type === 'name') {
      if (Object.hasOwn(LITERALS, token.value)) return LITERALS[token.value];
      return parseReference(token);
    }
    return fail(`Unexpected "${token.value ?? token.type}"`, token);
  }

  expect('(');
  if (peek().type !== '{') fail('DSL file must contain an object literal');
  const value = parseObject();
  expect(')');
  if (peek().type === ';') next();
  if (peek().type !== 'end') fail('Unexpected content after declaration');
  return value;
};

const isRef = (value) => value instanceof Ref;

// All references inside a DSL value, in order.
const refsOf = (value, found = []) => {
  if (value instanceof Ref) {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) refsOf(value[i], found);
  } else if (value && typeof value === 'object') {
    const items = Object.values(value);
    for (let i = 0; i < items.length; i++) refsOf(items[i], found);
  }
  return found;
};

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !isRef(value);

module.exports = { parse, Ref, isRef, isPlainObject, refsOf, SyntaxFailure };
