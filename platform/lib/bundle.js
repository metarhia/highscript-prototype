'use strict';

// Browser bundle of an application: the same plan and the same runtime as
// in Node.js, with component modules wrapped into a module registry.

const fs = require('node:fs');
const path = require('node:path');
const { createRequire, isBuiltin } = require('node:module');
const { planApplication } = require('./planner.js');
const {
  platformFile,
  isPlatform,
  isRelative,
  within,
  PLATFORM,
} = require('./modules.js');

const REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const RUNTIME = path.join(PLATFORM, 'lib', 'runtime.js');

// Same require rules as the Node.js module loader, without npm packages.
const resolve = (id, file, boundary, specifier) => {
  if (isPlatform(specifier)) return [platformFile(specifier), PLATFORM];
  if (isBuiltin(specifier)) {
    throw new Error(`${id}: "${specifier}" is not available in browsers`);
  }
  if (!isRelative(specifier)) {
    throw new Error(`${id}: package "${specifier}" is not bundled`);
  }
  const target = createRequire(file).resolve(specifier);
  if (!within(boundary, target)) {
    throw new Error(
      `${id}: require("${specifier}") leaves the component boundary`,
    );
  }
  return [target, boundary];
};

const collect = (rootDir) => {
  const files = new Map();
  const idOf = (file) => {
    const base = file.startsWith(PLATFORM) ? PLATFORM : rootDir;
    const prefix = base === PLATFORM ? 'highscript' : 'app';
    return `${prefix}:${path.relative(base, file).split(path.sep).join('/')}`;
  };
  const add = (file, boundary) => {
    const id = idOf(file);
    if (files.has(id)) return id;
    const source = fs.readFileSync(file, 'utf8');
    const entry = { id, source, deps: {} };
    files.set(id, entry);
    for (const [, specifier] of source.matchAll(REQUIRE)) {
      entry.deps[specifier] = add(...resolve(id, file, boundary, specifier));
    }
    return id;
  };
  return { files, add };
};

const buildBundle = (model, app, { env }) => {
  const plan = planApplication(model, app, { env });
  const { files, add } = collect(model.rootDir);
  const runtime = add(RUNTIME, PLATFORM);
  const moduleIds = {};
  for (const [id, { file, boundary }] of Object.entries(plan.modules)) {
    moduleIds[id] = add(file, boundary);
  }
  const browserPlan = { ...plan };
  delete browserPlan.modules;
  const definitions = [...files.values()]
    .map(
      ({ id, source, deps }) =>
        `  ${JSON.stringify(id)}: [` +
        `function (exports, require, module) {\n${source}\n}, ` +
        `${JSON.stringify(deps)}],`,
    )
    .join('\n');
  const js = `// ${app.id} (${env}) built by highscript
(() => {
'use strict';
const definitions = {
${definitions}
};
const cache = {};
const load = (id) => {
  if (cache[id]) return cache[id].exports;
  const [fn, deps] = definitions[id];
  const module = { exports: {} };
  cache[id] = module;
  const local = (specifier) => {
    const target = deps[specifier];
    if (!target) throw new Error('Cannot require ' + specifier + ' from ' + id);
    return load(target);
  };
  fn(module.exports, local, module);
  return module.exports;
};
const plan = ${JSON.stringify(browserPlan)};
const moduleIds = ${JSON.stringify(moduleIds)};
const { assemble } = load(${JSON.stringify(runtime)});
const loadModule = (id) => load(moduleIds[id]);
const ready = assemble(plan, { loadModule }).then(async (app) => {
  globalThis.highscript.app = app;
  await app.start();
  return app;
});
globalThis.highscript = { ready };
globalThis.highscript.ready.catch((error) => console.error(error));
})();
`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${app.name}</title>
</head>
<body>
<div id="app"></div>
<script src="app.js"></script>
</body>
</html>
`;
  return { html, js, plan };
};

module.exports = { buildBundle };
