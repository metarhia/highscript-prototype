'use strict';

// Architecture check: validates folder structure and DSL, plans every
// application, then compares code with DSL and reports usage.
// Severities: error (cannot run), warning (likely a mistake),
// hint (improvement).

const fs = require('node:fs');
const path = require('node:path');
const {
  where,
  descendants,
  ancestors,
  commonUnit,
  APPLICATION_RANK,
  VERSION,
} = require('./loader.js');
const { analyzeModel, findLexical } = require('./planner.js');
const { isRef, isPlainObject, refsOf } = require('./parser.js');
const { schemaRefs } = require('./schema.js');
const { planned, NOT_IMPLEMENTED } = require('./scaffold.js');

const DEFINITIONS = ['contracts', 'schemas', 'lib'];
const SERVICE_RANK = 3;
const RESERVED_SECTIONS = new Set(['application']);
const STUB = new RegExp(`new Error\\(\\s*['"\`]${NOT_IMPLEMENTED}`);
const CODE_REF = /\b(contracts|schemas|lib)\.([A-Za-z_$][\w$]*)(?:\.(v\d+))?/g;

const componentsOf = (unit) =>
  [...unit.children.values()].filter((child) => child.kind === 'component');

// require('../name.js') or require('../name/...') in a test file.
const requires = (name) =>
  new RegExp(
    `require\\(\\s*['"\`]\\.\\./${name.replace(/\$/g, '\\$')}(?:\\.js|/)`,
  );

class ArchitectureCheck {
  constructor(model, env) {
    this.model = model;
    this.env = env;
    const analysis = analyzeModel(model, { env });
    this.report = analysis.diagnostics;
    this.resolver = analysis.resolver;
    this.plans = analysis.plans;
    this.loader = analysis.loader;
    this.units = descendants(model.root);
    this.users = new Map();
    this.versions = new Map();
    this.texts = new Map();
  }

  // Usage inside an application is known only if it planned; usage of
  // logical units comes from DSL that resolves without code.
  planned(unit) {
    return !unit.application || this.plans.has(unit.application.id);
  }

  // Source texts of a component: its file or all .js files of its folder.
  sources(component) {
    let texts = this.texts.get(component);
    if (texts) return texts;
    const files =
      component.boundary === component.file
        ? [component.file]
        : fs
            .readdirSync(component.boundary, { recursive: true })
            .filter((name) => name.endsWith('.js'))
            .map((name) => path.join(component.boundary, name));
    texts = files.map((file) => fs.readFileSync(file, 'utf8'));
    this.texts.set(component, texts);
    return texts;
  }

  // Code that no application assembles.
  unreachable() {
    for (const plan of this.plans.values()) {
      const app = this.model.units.get(plan.application);
      for (const unit of descendants(app)) {
        for (const component of componentsOf(unit)) {
          if (plan.nodes[component.id]) continue;
          const message =
            'component is not reachable from the application exposes';
          this.report.warning('UNREACHABLE', where(component.file), message);
        }
      }
    }
  }

  // consumes entries nothing resolves, unused config sections.
  unused() {
    const { consumes, sections, entries } = this.resolver.used;
    for (const unit of this.units) {
      if (!this.planned(unit)) continue;
      for (const name of Object.keys(unit.dsl.consumes)) {
        if (consumes.has(`${unit.id}#${name}`)) continue;
        this.report.warning(
          'UNUSED_CONSUMES',
          where(unit.file),
          `consumes.${name} is not used`,
        );
      }
      if (unit.rank >= SERVICE_RANK) {
        for (const name of Object.keys(unit.dsl.exposes)) {
          if (entries.has(`${unit.id}#${name}`)) continue;
          this.report.hint(
            'UNUSED_EXPOSES',
            where(unit.file),
            `exposes.${name} is not used`,
          );
        }
      }
      if (unit.rank !== APPLICATION_RANK || !unit.config) continue;
      const config = path.join(unit.dir, 'config');
      for (const name of unit.config.base.keys()) {
        if (sections.has(`${unit.id}#${name}`) || RESERVED_SECTIONS.has(name)) {
          continue;
        }
        const message = `section "${name}" is not used by any component`;
        this.report.warning(
          'UNUSED_CONFIG',
          where(path.join(config, `${name}.json`)),
          message,
        );
      }
    }
    for (const unit of this.units) {
      if (!unit.config) continue;
      for (const [env, overrides] of unit.config.environments) {
        for (const name of overrides.keys()) {
          if (unit.config.base.has(name)) continue;
          const file = path.join(unit.dir, 'config', env, `${name}.json`);
          const message =
            `environment section "${name}" ` +
            `has no base config/${name}.json`;
          this.report.warning('ENV_SECTION', where(file), message);
        }
      }
    }
  }

  // Users of contracts, schemas and lib: DSL references, Metaschema type
  // strings, endpoints consumed through `from`, namespace use in code.
  use(unit, ns, name, version = null) {
    const def = findLexical(unit, ns, name);
    if (def) this.useDefinition(def, unit, version);
  }

  useDefinition(def, unit, version) {
    if (!this.users.has(def)) this.users.set(def, new Set());
    this.users.get(def).add(unit);
    if (def.versions && VERSION.test(version)) {
      if (!this.versions.has(def)) this.versions.set(def, new Set());
      this.versions.get(def).add(version);
    }
  }

  useRefs(unit, value) {
    for (const ref of refsOf(value)) {
      const [ns, name, version] = ref.path;
      if (DEFINITIONS.includes(ns) && name) this.use(unit, ns, name, version);
    }
  }

  collectUsers() {
    for (const unit of this.units) {
      this.useRefs(unit, unit.dsl);
      for (const kind of ['contracts', 'schemas']) {
        for (const def of unit[kind].values()) {
          const items = def.versions ? [...def.versions.values()] : [def];
          for (const { value } of items) {
            this.useRefs(unit, value);
            if (kind !== 'schemas') continue;
            for (const ref of schemaRefs(value)) {
              const [name, version] = ref.split('.');
              this.use(unit, 'schemas', name, version);
            }
          }
        }
      }
      // A unit that publishes an endpoint is a party of its contract.
      for (const value of Object.values(unit.dsl.exposes)) {
        if (!isRef(value)) continue;
        try {
          const target = this.resolver.resolve(value, unit);
          const { def, version } = this.resolver.endpointOf(
            target,
            value,
            unit.id,
          );
          this.useDefinition(def, unit, version);
        } catch {
          // not an endpoint: a published unit
        }
      }
      for (const [name, value] of Object.entries(unit.dsl.consumes)) {
        const from = isPlainObject(value) ? value.from : null;
        if (!from || !unit.parent) continue;
        try {
          const { def, version } = this.resolver.endpoint(
            from,
            unit.parent,
            name,
          );
          this.useDefinition(def, unit, version);
        } catch {
          // reported by the model check
        }
      }
      for (const component of componentsOf(unit)) {
        for (const text of this.sources(component)) {
          for (const [, ns, name, version] of text.matchAll(CODE_REF)) {
            this.use(unit, ns, name, version);
          }
        }
      }
    }
  }

  // Unused definitions and versions, definitions placed above their users.
  definitions() {
    this.collectUsers();
    for (const unit of this.units) {
      for (const ns of DEFINITIONS) {
        for (const def of unit[ns].values()) {
          const file = def.file || path.join(unit.dir, ns, def.name);
          const users = Array.from(this.users.get(def) || []);
          if (users.length === 0) {
            this.report.warning(
              'UNUSED_DEFINITION',
              where(file),
              `${ns}.${def.name} is not used`,
            );
            continue;
          }
          const owner = commonUnit(users);
          if (owner !== unit && ancestors(owner).includes(unit)) {
            const target = `${where(owner.dir)}/${ns}/`;
            const message =
              `${ns}.${def.name} is used only inside ${owner.id}: ` +
              `move it to ${target}`;
            this.report.hint('PLACEMENT', where(file), message);
          }
          if (!def.versions) continue;
          // Older versions nobody pins any more can be retired (the loader
          // keeps versions in numeric order, the last one is the latest).
          const pinned = this.versions.get(def) || new Set();
          for (const version of [...def.versions.keys()].slice(0, -1)) {
            if (pinned.has(version)) continue;
            const name = `${ns}.${def.name}.${version}`;
            const message = `${name} is not pinned by any consumer`;
            this.report.hint(
              'UNUSED_VERSION',
              where(def.versions.get(version).file),
              message,
            );
          }
        }
      }
    }
  }

  // Templates left unimplemented, operations without tests or contracts.
  code() {
    for (const unit of this.units) {
      const tests = path.join(unit.dir, 'test');
      const testText = fs.existsSync(tests)
        ? fs
            .readdirSync(tests)
            .filter((name) => name.endsWith('.js'))
            .map((name) => fs.readFileSync(path.join(tests, name), 'utf8'))
            .join('\n')
        : '';
      for (const component of componentsOf(unit)) {
        if (this.sources(component).some((text) => STUB.test(text))) {
          const message = 'scaffold template is not implemented yet';
          this.report.warning('STUB', where(component.file), message);
        }
        const entry = unit.dsl.exposes[component.name];
        const checked =
          isPlainObject(entry) && entry.contract && !entry.transport;
        const tested = requires(component.name).test(testText);
        if (checked && !tested) {
          const file = `../${component.name}.js`;
          const message = `no test in ${where(tests)}/ requires ${file}`;
          this.report.hint('MISSING_TEST', where(component.file), message);
        }
        if (
          unit.level === 'service' &&
          isPlainObject(entry) &&
          !entry.contract
        ) {
          const message = `service operation ${component.name} has no contract`;
          this.report.hint('NO_CONTRACT', where(unit.file), message);
        }
      }
    }
  }

  // What `highscript scaffold` would generate, from the loaded model.
  scaffolding() {
    try {
      const options = { env: this.env, loader: this.loader };
      const created = planned(this.model, options);
      if (created.length === 0) return;
      const message =
        `${created.length} file(s) can be generated from DSL, ` +
        `run highscript scaffold: ${created.join(', ')}`;
      this.report.hint('SCAFFOLD', where(this.model.rootDir), message);
    } catch (error) {
      this.report.hint('SCAFFOLD', where(this.model.rootDir), error.message);
    }
  }

  run() {
    this.unreachable();
    this.unused();
    this.definitions();
    this.code();
    this.scaffolding();
    return this.report;
  }
}

const checkArchitecture = (model, { env }) =>
  new ArchitectureCheck(model, env).run();

module.exports = { checkArchitecture };
