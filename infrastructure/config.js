'use strict';

const { readFile } = require('node:fs/promises');
const path = require('node:path');

const { isHashObject } = require('metautil');

const readText = async (fileName) => {
  try {
    return await readFile(fileName, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const message = `Configuration file not found: ${fileName}`;
    throw new Error(message, { cause: error });
  }
};

const parseSettings = (raw) => {
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid configuration', { cause: error });
  }
  if (!isHashObject(settings)) throw new Error('Invalid configuration');
  return settings;
};

const open = async ({ fileName }) => {
  const resolved = path.resolve(__dirname, '..', fileName);
  const raw = await readText(resolved);
  const settings = parseSettings(raw);
  const read = (name) => {
    const known = typeof name === 'string' && Object.hasOwn(settings, name);
    if (!known) throw new Error(`Unknown configuration: ${name}`);
    return settings[name];
  };
  return { read };
};

module.exports = { readText, parseSettings, open };
