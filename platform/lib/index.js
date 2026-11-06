'use strict';

// Public API of the platform (Node.js side).

const path = require('node:path');
const { loadModel, isUnit } = require('./loader.js');
const { ModuleLoader } = require('./modules.js');
const fs = require('node:fs');
const { checkArchitecture } = require('./architecture.js');
const {
  applications,
  hasCode,
  Resolver,
  Planner,
  PlanError,
} = require('./planner.js');
const { assemble: run, createAssembly } = require('./runtime.js');
const { stub } = require('./contracts.js');
const { buildBundle } = require('./bundle.js');
const { convert, print } = require('./convert.js');
const { scaffold, init } = require('./scaffold.js');
const { diagram, diagrams } = require('./diagram.js');
const { Ref } = require('./parser.js');
const { createServer } = require('../adapters/http-server.js');
const { createClient } = require('../adapters/http-client.js');
const { openLogger } = require('../adapters/logger.js');

const environment = (env) => env || process.env.HIGHSCRIPT_ENV || 'development';

// Unit by object, id ('Enterprise.PaymentSystem') or folder path.
const findUnit = (model, ref) => {
  if (ref && typeof ref === 'object') return ref;
  const unit = model.units.get(ref) || model.findUnit(ref);
  if (!unit) throw new PlanError(`Unknown unit ${ref}`);
  return unit;
};

const findApplication = (model, app) => {
  const unit = findUnit(model, app);
  if (unit.level !== 'application') {
    throw new PlanError(`${unit.id} is not an application`);
  }
  return unit;
};

// Architecture check: { errors, warnings, hints } of Diagnostic objects.
const check = (model, options = {}) =>
  checkArchitecture(model, { env: environment(options.env) });

// Diagrams of a unit (object, id or folder; the root by default):
// `diagram` gives Mermaid of one view expanded `depth` levels,
// `diagrams` a document (format md, html or mmd) with a landscape and a
// view of every unit inside.
const drawing =
  (draw) =>
  (model, unit = model.root, options = {}) =>
    draw(model, findUnit(model, unit), {
      ...options,
      env: environment(options.env),
    });

// Model folder for commands run without a path: the unit containing the
// working directory, or the only unit folder directly inside it.
const locate = (start = process.cwd()) => {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (isUnit(dir)) return dir;
    if (dir === path.dirname(dir)) break;
  }
  const dir = path.resolve(start);
  const units = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && isUnit(path.join(dir, entry.name)),
    )
    .map((entry) => path.join(dir, entry.name));
  if (units.length === 1) return units[0];
  if (units.length === 0) {
    throw new Error('No architecture model here: no level file found');
  }
  const names = units.map((unit) => path.basename(unit)).join(', ');
  throw new Error(`Several models here (${names}): pass one`);
};

// options: { env, config: { [section]: value } } where config overrides
// sections of the planned application after its environment.
const planner = (model, app, options = {}) => {
  const unit = findApplication(model, app);
  const overrides = options.config ? { [unit.id]: options.config } : {};
  const resolver = new Resolver(model, environment(options.env), overrides);
  return new Planner(resolver, unit);
};

const plan = (model, app, options) => planner(model, app, options).build();

const nodeModules =
  (built, loader = new ModuleLoader()) =>
  (id) => {
    const { file, boundary } = built.modules[id];
    return loader.load(file, boundary);
  };

// Reuses modules the planner already loaded to read factory signatures.
const assemble = (model, app, options) => {
  const current = planner(model, app, options);
  const built = current.build();
  return run(built, { loadModule: nodeModules(built, current.loader) });
};

// Unbuilt assembly of a plan: create single components with
// assembly.node(id) or compile schemas.
const instantiate = (built) =>
  createAssembly(built, { loadModule: nodeModules(built) });

const start = async (model, app, options = {}) => {
  const application = await assemble(model, app, options);
  await application.start();
  return application;
};

const config = (model, app, section, options = {}) => {
  const resolver = new Resolver(model, environment(options.env));
  const sections = resolver.config(findApplication(model, app));
  if (!sections.has(section)) {
    throw new PlanError(`No config section ${section}`);
  }
  return structuredClone(sections.get(section));
};

// Remote stub for an endpoint, e.g. 'PaymentGateway.operator.v1',
// resolved from the model root; used by scenarios and tools.
const connect = (model, endpoint, { url, token, timeoutMs, env } = {}) => {
  const current = new Planner(
    new Resolver(model, environment(env)),
    model.root,
  );
  const contract = current.resolver.endpoint(
    new Ref(endpoint.split('.')),
    model.root,
    'connect',
  );
  const contractId = current.remoteContract(contract, endpoint);
  const { contracts } = createAssembly(current.plan, {
    loadModule: nodeModules(current.plan),
  });
  const { def, version } = contract;
  const via = createClient({ url, token, timeoutMs });
  return stub(
    { contract: contracts.get(contractId), name: def.name, version },
    via,
  );
};

const serve = async (model, app, options = {}) => {
  const unit = findApplication(model, app);
  const env = environment(options.env);
  const { html, js } = buildBundle(model, unit, { env });
  const sections = new Resolver(model, env).config(unit);
  const settings = {
    host: '127.0.0.1',
    port: 8000,
    basePath: '',
    ...sections.get('application')?.serve,
  };
  const logger = openLogger({ name: unit.name, level: 'warn' });
  const server = createServer({ options: settings, logger });
  const file = (type, body) => () => ({
    body,
    headers: { 'content-type': `${type}; charset=utf-8` },
  });
  server.route('GET', '/', file('text/html', html));
  server.route('GET', '/index.html', file('text/html', html));
  server.route('GET', '/app.js', file('text/javascript', js));
  await server.start();
  return { id: unit.id, address: `${server.address}/`, close: server.close };
};

// Starts every implemented application below a unit: browser applications
// (config/application.json has "serve") are bundled and served, the rest
// are assembled and started in this process.
const up = async (model, unit = model.root, options = {}) => {
  const env = environment(options.env);
  const log = options.log || openLogger({ name: 'highscript' });
  const root = findUnit(model, unit);
  const resolver = new Resolver(model, env);
  const running = [];
  const skipped = [];
  const close = async () => {
    for (const item of running.reverse()) await item.close();
  };
  try {
    for (const app of applications(root)) {
      if (!hasCode(app)) {
        skipped.push(app.id);
        continue;
      }
      const settings = resolver.config(app).get('application');
      if (settings?.serve) {
        const served = await serve(model, app, { env });
        log.info(`${app.id} served at ${served.address}`);
        running.push(served);
      } else {
        const application = await start(model, app, { env });
        log.info(`${app.id} started`);
        running.push(application);
      }
    }
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
  return { env, running, skipped, close };
};

// Loads a single project module the way the platform does (guarded require).
const loadModule = (file) => {
  const resolved = path.resolve(file);
  return new ModuleLoader().load(resolved, path.dirname(resolved));
};

module.exports = {
  load: loadModel,
  locate,
  check,
  diagram: drawing(diagram),
  diagrams: drawing(diagrams),
  plan,
  assemble,
  instantiate,
  start,
  config,
  connect,
  serve,
  up,
  bundle: (model, app, options = {}) =>
    buildBundle(model, findApplication(model, app), {
      env: environment(options.env),
    }),
  loadModule,
  environment,
  convert,
  print,
  scaffold: (target, options = {}) =>
    scaffold(target, { ...options, env: environment(options.env) }),
  init,
};
