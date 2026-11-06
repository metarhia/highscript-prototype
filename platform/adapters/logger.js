'use strict';

// Injected logger: never replaces global console. Isomorphic.

const LEVELS = ['debug', 'info', 'warn', 'error'];

const openLogger = ({ name = 'app', level = 'info', write } = {}) => {
  const threshold = level === 'silent' ? LEVELS.length : LEVELS.indexOf(level);
  if (threshold === -1) throw new Error(`Unknown log level ${level}`);
  const output =
    write ||
    ((severity, line) => {
      const target =
        severity === 'error' || severity === 'warn' ? 'error' : 'log';
      console[target](line);
    });
  const emit = (severity, values) => {
    if (LEVELS.indexOf(severity) < threshold) return;
    const time = new Date().toISOString().slice(11, 23);
    const text = values
      .map((value) =>
        typeof value === 'string' ? value : JSON.stringify(value),
      )
      .join(' ');
    output(severity, `${time} ${name} ${severity}: ${text}`);
  };
  const logger = {};
  for (const severity of LEVELS) {
    logger[severity] = (...values) => emit(severity, values);
  }
  return Object.freeze(logger);
};

module.exports = { openLogger, LEVELS };
