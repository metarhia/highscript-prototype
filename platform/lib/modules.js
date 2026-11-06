'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire, isBuiltin } = require('node:module');

const PLATFORM = path.resolve(__dirname, '..');
const ADAPTERS = path.join(PLATFORM, 'adapters');

// Maps a platform specifier to its file: 'highscript/json-store'
const platformFile = (specifier) => {
  if (specifier === 'highscript') return path.join(PLATFORM, 'lib', 'index.js');
  const name = specifier.slice('highscript/'.length);
  return path.join(ADAPTERS, `${name}.js`);
};

const isPlatform = (specifier) =>
  specifier === 'highscript' || specifier.startsWith('highscript/');

const isRelative = (specifier) =>
  specifier.startsWith('./') || specifier.startsWith('../');

const within = (dir, file) => {
  const relative = path.relative(dir, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// Loads project code (components, lib) with a guarded require:
// node built-ins, npm packages and platform adapters are allowed,
// relative paths only inside the module's own boundary directory.
class ModuleLoader {
  #cache = new Map();

  load(file, boundary = path.dirname(file)) {
    const filename = path.resolve(file);
    const cached = this.#cache.get(filename);
    if (cached) return cached.exports;
    const source = fs.readFileSync(filename, 'utf8');
    const module = { exports: {} };
    this.#cache.set(filename, module);
    const native = createRequire(filename);
    const guarded = (specifier) => {
      if (isBuiltin(specifier)) return native(specifier);
      if (isPlatform(specifier)) return require(platformFile(specifier));
      if (isRelative(specifier)) {
        const target = native.resolve(specifier);
        if (!within(boundary, target)) {
          const where = path.relative(process.cwd(), filename);
          const message =
            `${where}: require("${specifier}") leaves the component ` +
            'boundary; use ports instead';
          throw Object.assign(new Error(message), { code: 'BOUNDARY' });
        }
        return this.load(target, boundary);
      }
      return native(specifier);
    };
    const params = ['exports', 'require', 'module', '__filename', '__dirname'];
    const fn = vm.compileFunction(source, params, { filename });
    fn(module.exports, guarded, module, filename, path.dirname(filename));
    return module.exports;
  }
}

// Factory parameter names from a destructuring signature: ({ a, b }) => ...
const signature = (fn) => {
  const source = Function.prototype.toString.call(fn);
  const match = source.match(
    /^(?:async\s*)?(?:function\s*\w*\s*)?\(\s*(\{[^}]*\})?\s*\)/,
  );
  if (!match) return null;
  if (!match[1]) return [];
  return match[1]
    .slice(1, -1)
    .split(',')
    .map((part) => part.trim().split(/[:=\s]/)[0])
    .filter(Boolean);
};

module.exports = {
  ModuleLoader,
  signature,
  platformFile,
  isPlatform,
  isRelative,
  within,
  PLATFORM,
};
