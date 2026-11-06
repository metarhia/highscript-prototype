'use strict';

// Three representations of one DSL value: JS (`({ ... });`), Lisp and
// Markdown. Lisp and Markdown share a tree of entries: an entry is a key,
// an optional value word and nested entries.
//
//   JS                       Lisp                    Markdown
//   { WebClient }            (WebClient)             - WebClient
//   { api: PaymentService }  (api PaymentService)    - api PaymentService
//   { ui: {} }               (ui {})                 - ui {}
//   { enum: ['A', 'B'] }     (enum ["A" "B"])        - enum ["A" "B"]
//   { open: { logger } }     (open (logger))         - open
//                                                      - logger
//
// Words are references (a.b.c), strings, numbers, true, false, null,
// arrays in [ ] and the empty object {}. A parsed value is plain data with
// Ref instances, the same as from the JS parser.

const {
  parse: parseJs,
  Ref,
  isRef,
  isPlainObject,
  SyntaxFailure,
} = require('./parser.js');

const SYNTAXES = ['js', 'lisp', 'md'];
const KEY = /^[A-Za-z_$][\w$]*$/;
const NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const WORD =
  /;[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\{\}|[[\]()]|[^\s()[\];]+/g;
const LITERALS = { true: true, false: false, null: null };
const QUOTE = '\u0027';
const WIDTH = 80;

// { key } shorthand: the value is a reference to the same name.
const isShorthand = (key, value) =>
  isRef(value) && value.path.length === 1 && value.head === key;

const syntaxOf = (file) => {
  const syntax = file.slice(file.lastIndexOf('.') + 1);
  return SYNTAXES.includes(syntax) ? syntax : null;
};

// Tokens of one source text with line numbers; `;` starts a comment.
const tokenize = (text, file, line = 1) => {
  const tokens = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const content = lines[index];
    for (const match of content.matchAll(WORD)) {
      if (match[0].startsWith(';')) continue;
      const loc = { line: line + index, column: match.index + 1 };
      tokens.push({ text: match[0], loc });
    }
  }
  return { tokens, file };
};

const unquote = (text) => {
  if (text.startsWith('"')) return JSON.parse(text);
  const inner = text
    .slice(1, -1)
    .replaceAll(`\\${QUOTE}`, QUOTE)
    .replace(/"/g, '\\"');
  return JSON.parse(`"${inner}"`);
};

// Reads one word (atom, array or {}) starting at tokens[position].
const readWord = (state) => {
  const { tokens, file } = state;
  const token = tokens[state.position++];
  const fail = (message) => {
    throw new SyntaxFailure(message, file, token.loc);
  };
  const { text } = token;
  if (text === '[') {
    const array = [];
    while (tokens[state.position]?.text !== ']') {
      if (state.position >= tokens.length) fail('Unterminated array');
      array.push(readWord(state).value);
    }
    state.position++;
    return { value: array, loc: token.loc };
  }
  if (text === '{}') return { value: {}, loc: token.loc };
  if (text === ']' || text === '(' || text === ')') {
    fail(`Unexpected "${text}"`);
  }
  if (text.startsWith('"') || text.startsWith(QUOTE)) {
    return { value: unquote(text), loc: token.loc };
  }
  if (Object.hasOwn(LITERALS, text)) {
    return { value: LITERALS[text], loc: token.loc };
  }
  if (NUMBER.test(text)) return { value: Number(text), loc: token.loc };
  if (!NAME.test(text)) fail(`Unexpected "${text}"`);
  return {
    value: new Ref(text.split('.'), token.loc),
    loc: token.loc,
    name: text,
  };
};

// Entries tree to object: (key) shorthand, (key value), (key entries...).
const toObject = (nodes, file) => {
  const object = {};
  for (const { words, children, loc } of nodes) {
    const [key, ...rest] = words;
    if (!key?.name || !KEY.test(key.name)) {
      throw new SyntaxFailure('Expected entry name', file, key?.loc || loc);
    }
    const name = key.name;
    if (Object.hasOwn(object, name)) {
      throw new SyntaxFailure(`Duplicate key "${name}"`, file, key.loc);
    }
    if (children.length > 0) {
      if (rest.length > 0) {
        throw new SyntaxFailure('Value and nested entries', file, key.loc);
      }
      object[name] = toObject(children, file);
    } else if (rest.length === 0) {
      object[name] = new Ref([name], key.loc);
    } else if (rest.length === 1) {
      object[name] = rest[0].value;
    } else {
      throw new SyntaxFailure(
        'Several values: use [ ] for arrays',
        file,
        key.loc,
      );
    }
  }
  return object;
};

const parseLisp = (text, file) => {
  const state = { ...tokenize(text, file), position: 0 };
  const { tokens } = state;
  const list = () => {
    const open = tokens[state.position++];
    const node = { words: [], children: [], loc: open.loc };
    for (;;) {
      const token = tokens[state.position];
      if (!token) throw new SyntaxFailure('Unterminated list', file, open.loc);
      if (token.text === ')') break;
      if (token.text === '(') {
        node.children.push(list());
      } else if (node.children.length > 0) {
        throw new SyntaxFailure('Value after nested entries', file, token.loc);
      } else {
        node.words.push(readWord(state));
      }
    }
    state.position++;
    return node;
  };
  const nodes = [];
  while (state.position < tokens.length) {
    const token = tokens[state.position];
    if (token.text !== '(') {
      throw new SyntaxFailure('Expected "("', file, token.loc);
    }
    nodes.push(list());
  }
  return toObject(nodes, file);
};

// List items `- words` nested by two spaces; blank and # lines are skipped.
const parseMd = (text, file) => {
  const roots = [];
  const stack = [roots];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || line.startsWith('#')) continue;
    const loc = { line: index + 1, column: 1 };
    const matched = /^( *)- (.+)$/.exec(line);
    if (!matched || matched[1].length % 2) {
      throw new SyntaxFailure('Expected list item "- "', file, loc);
    }
    const depth = matched[1].length / 2;
    if (depth >= stack.length) {
      throw new SyntaxFailure('Invalid indentation', file, loc);
    }
    const state = { ...tokenize(matched[2], file, index + 1), position: 0 };
    const words = [];
    while (state.position < state.tokens.length) words.push(readWord(state));
    const node = { words, children: [], loc };
    stack[depth].push(node);
    stack.length = depth + 1;
    stack.push(node.children);
  }
  return toObject(roots, file);
};

const parseSource = (text, syntax, file = `<${syntax}>`) => {
  if (syntax === 'js') return parseJs(text, file);
  if (syntax === 'lisp') return parseLisp(text, file);
  if (syntax === 'md') return parseMd(text, file);
  throw new Error(`Unknown syntax ${syntax}`);
};

// Formatting

const cannot = (syntax, why) => {
  throw new Error(`Cannot represent in ${syntax}: ${why}`);
};

const word = (value, syntax) => {
  if (isRef(value)) return value.path.join('.');
  if (Array.isArray(value)) {
    return `[${value.map((item) => word(item, syntax)).join(' ')}]`;
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) return '{}';
    return cannot(syntax, 'object inside an array');
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    cannot(syntax, 'number');
  }
  return String(value);
};

const entries = (object, syntax) =>
  Object.entries(object).map(([key, value]) => {
    if (!KEY.test(key)) cannot(syntax, `key "${key}"`);
    if (isShorthand(key, value)) return { words: [key], children: [] };
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      return { words: [key], children: entries(value, syntax) };
    }
    return { words: [key, word(value, syntax)], children: [] };
  });

const lispNode = ({ words, children }, depth) => {
  const head = words.join(' ');
  const nested = children.map((child) => lispNode(child, depth + 1));
  const inline = `(${[head, ...nested].join(' ')})`;
  const fits = depth * 2 + inline.length <= WIDTH && !inline.includes('\n');
  if (fits) return inline;
  const pad = '  '.repeat(depth + 1);
  return `(${head}\n${nested.map((line) => pad + line).join('\n')})`;
};

const mdNode = ({ words, children }, depth) => [
  `${'  '.repeat(depth)}- ${words.join(' ')}`,
  ...children.flatMap((child) => mdNode(child, depth + 1)),
];

const jsString = (text) =>
  QUOTE +
  text
    .replace(/\\/g, '\\\\')
    .replaceAll(QUOTE, `\\${QUOTE}`)
    .replace(/\n/g, '\\n') +
  QUOTE;

const jsValue = (value, depth) => {
  if (isRef(value)) return value.path.join('.');
  if (typeof value === 'string') return jsString(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return String(value);
  const pad = '  '.repeat(depth);
  const array = Array.isArray(value);
  const items = array
    ? value.map((item) => jsValue(item, depth + 1))
    : Object.entries(value).map(([key, item]) => {
        const name = KEY.test(key) ? key : jsString(key);
        if (isShorthand(key, item)) return name;
        return `${name}: ${jsValue(item, depth + 1)}`;
      });
  const [open, close] = array ? ['[', ']'] : ['{', '}'];
  if (items.length === 0) return `${open}${close}`;
  const space = array ? '' : ' ';
  const inline = `${open}${space}${items.join(', ')}${space}${close}`;
  if (
    depth > 0 &&
    !inline.includes('\n') &&
    pad.length + inline.length <= WIDTH - 10
  ) {
    return inline;
  }
  const lines = items.map((item) => `${pad}  ${item},`).join('\n');
  return `${open}\n${lines}\n${pad}${close}`;
};

const formatValue = (value, syntax) => {
  if (syntax === 'js') return `(${jsValue(value, 0)});\n`;
  const nodes = entries(value, syntax);
  if (syntax === 'lisp') {
    return `${nodes.map((node) => lispNode(node, 0)).join('\n')}\n`;
  }
  if (syntax === 'md') {
    return `${nodes.flatMap((node) => mdNode(node, 0)).join('\n')}\n`;
  }
  throw new Error(`Unknown syntax ${syntax}`);
};

// Structural equality of DSL values: references compare by path.
const same = (a, b) => {
  if (isRef(a) || isRef(b)) {
    return isRef(a) && isRef(b) && a.path.join('.') === b.path.join('.');
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => same(item, b[i]))
    );
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keys = Object.keys(a);
    const other = Object.keys(b);
    if (keys.length !== other.length) return false;
    return keys.every((key, i) => other[i] === key && same(a[key], b[key]));
  }
  return Object.is(a, b);
};

// Formats and checks that parsing the text gives the same value.
const convertValue = (value, syntax) => {
  const text = formatValue(value, syntax);
  if (!same(parseSource(text, syntax), value)) {
    throw new Error(`Cannot represent in ${syntax}: round trip differs`);
  }
  return text;
};

module.exports = {
  SYNTAXES,
  syntaxOf,
  parseSource,
  formatValue,
  convertValue,
  same,
};
