'use strict';

const { appendFile } = require('node:fs/promises');
const { format } = require('node:util');
const path = require('node:path');

const LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'];

const open = ({ fileName }) => {
  if (typeof fileName !== 'string' || fileName === '') {
    throw new Error('Expected log file');
  }
  let pending = Promise.resolve();
  const target = path.resolve(__dirname, '..', fileName);
  const emit = (level, values) => {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} ${level} ${format(...values)}\n`;
    pending = pending.then(() => appendFile(target, line));
    return pending;
  };
  const methods = Object.fromEntries(
    LEVELS.map((level) => [level, (...values) => emit(level, values)]),
  );
  const logger = {
    ...methods,
    close: () => pending,
    getInstance: () => logger,
  };
  return Object.freeze(logger);
};

module.exports = { open };
