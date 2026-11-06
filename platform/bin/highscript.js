#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const highscript = require('../lib/index.js');
const { where } = require('../lib/loader.js');
const { openLogger } = require('../adapters/logger.js');

const USAGE = `Usage: highscript <command> [path] [options]

Without a path, commands work on the model found from the current folder.

  check                      check architecture: structure, DSL, code against
                             DSL; prints errors, warnings and hints
  scaffold                   generate missing units, module templates and
                             config sections from DSL, then check
  diagram [unit] [--out f]   draw architecture from DSL: Markdown with
                             Mermaid (.md, default stdout), .html or .mmd
  init <dir> --level l       new unit folder with a starter level file
  convert <unit|file> --to s rewrite DSL files in js, lisp or md
  print <file> --to s        show a DSL file in another syntax
  plan <application>         print the assembly plan as JSON
  start <application>        assemble and start in Node.js
  build <application> --out  write a browser bundle (index.html, app.js)
  serve <application>        bundle and serve for browsers
  up [unit] [--scenario f]   start all implemented applications below a unit

Options: --env name (or HIGHSCRIPT_ENV, default "development"), --json for
machine-readable check and scaffold output, --dry to plan without writing,
--depth n for the levels a diagram expands (default down to applications).`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    env: { type: 'string' },
    out: { type: 'string' },
    scenario: { type: 'string' },
    to: { type: 'string' },
    syntax: { type: 'string' },
    level: { type: 'string' },
    depth: { type: 'string' },
    dry: { type: 'boolean' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, argument] = positionals;
const env = highscript.environment(values.env);
const log = openLogger({ name: 'highscript' });

const COLORS = { error: 31, warning: 33, hint: 36 };
const paint = (severity, text) =>
  process.stdout.isTTY ? `\x1b[${COLORS[severity]}m${text}\x1b[0m` : text;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const all = ({ errors, warnings, hints }) => [...errors, ...warnings, ...hints];

// Prints diagnostics one per line and a summary; returns true without errors.
const printDiagnostics = ({ errors, warnings, hints }) => {
  for (const item of all({ errors, warnings, hints })) {
    const label = paint(item.severity, item.severity.padEnd(7));
    console.log(`${label} ${item.code.padEnd(17)} ${item}`);
  }
  const summary = [
    plural(errors.length, 'error'),
    plural(warnings.length, 'warning'),
    plural(hints.length, 'hint'),
  ];
  console.log(`${summary.join(', ')} (env ${env})`);
  return errors.length === 0;
};

const check = (root, model = highscript.load(root)) => {
  const diagnostics = highscript.check(model, { env });
  if (values.json) {
    console.log(JSON.stringify(all(diagnostics), null, 2));
    return diagnostics.errors.length === 0;
  }
  return printDiagnostics(diagnostics);
};

const scaffold = (root) => {
  const { dry } = values;
  const report = highscript.scaffold(root, { env, dry });
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const file of report.created) {
    console.log(`${dry ? 'plan  ' : 'create'} ${file}`);
  }
  for (const warning of report.warnings) {
    console.log(`${paint('warning', 'warning')} ${warning}`);
  }
  console.log(
    `${plural(report.created.length, 'file')} ${dry ? 'planned' : 'created'}\n`,
  );
  if (!dry && !check(root, report.model)) process.exitCode = 1;
};

const FORMATS = { '.html': 'html', '.mmd': 'mmd' };

const diagram = (target) => {
  const depth = values.depth === undefined ? undefined : Number(values.depth);
  if (depth !== undefined && !(Number.isInteger(depth) && depth > 0)) {
    throw new Error(`--depth expects a positive integer, got ${values.depth}`);
  }
  const { out } = values;
  const format = (out && FORMATS[path.extname(out)]) || 'md';
  const model = highscript.load(target);
  const unit = model.findUnit(target) || model.root;
  const text = highscript.diagrams(model, unit, { env, depth, format });
  if (!out) return void process.stdout.write(text);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`write ${where(path.resolve(out))}`);
};

const waitForSignal = (close) => {
  const stop = async () => {
    log.info('stopping');
    await close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
};

const main = async () => {
  if (!command || values.help) {
    console.log(USAGE);
    return;
  }
  const target = argument || highscript.locate();
  if (command === 'check') {
    if (!check(target)) process.exitCode = 1;
    return;
  }
  if (command === 'scaffold') return void scaffold(target);
  if (command === 'diagram') return void diagram(target);
  if (command === 'init') {
    const { level, syntax } = values;
    for (const file of highscript.init(argument, { level, syntax })) {
      console.log(`create ${file}`);
    }
    return;
  }
  if (command === 'convert') {
    const changes = highscript.convert(target, {
      to: values.to,
      dry: values.dry,
    });
    for (const { from, to } of changes) {
      console.log(`${where(from)} -> ${where(to)}`);
    }
    const done = values.dry ? 'to convert' : 'converted';
    console.log(`${plural(changes.length, 'file')} ${done}`);
    return;
  }
  if (command === 'print') {
    process.stdout.write(highscript.print(target, values.to));
    return;
  }
  const model = highscript.load(target);
  if (command === 'plan') {
    const plan = highscript.plan(model, target, { env });
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (command === 'start') {
    const app = await highscript.start(model, target, { env });
    log.info(`${app.id} started (${env})`);
    waitForSignal(() => app.close());
    return;
  }
  if (command === 'build') {
    const out = path.resolve(values.out || 'dist');
    const { html, js } = highscript.bundle(model, target, { env });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'index.html'), html);
    fs.writeFileSync(path.join(out, 'app.js'), js);
    log.info(`bundle written to ${where(out)}`);
    return;
  }
  if (command === 'serve') {
    const served = await highscript.serve(model, target, { env });
    log.info(`${served.id} served at ${served.address}`);
    waitForSignal(() => served.close());
    return;
  }
  if (command === 'up') {
    const landscape = await highscript.up(model, model.findUnit(target), {
      env,
      log,
    });
    for (const id of landscape.skipped) log.info(`${id} skipped: design-only`);
    waitForSignal(() => landscape.close());
    if (values.scenario) {
      const scenario = require(path.resolve(values.scenario));
      const print = (line) => console.log(line);
      await scenario.run({ model, env, highscript, log: print });
      log.info('scenario finished, applications keep running (Ctrl+C to stop)');
    }
    return;
  }
  console.log(USAGE);
  process.exitCode = 1;
};

main().catch((error) => {
  log.error(error.stack || error.message);
  process.exit(1);
});
