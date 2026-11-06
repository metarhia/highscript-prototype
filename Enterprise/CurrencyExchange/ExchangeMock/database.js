'use strict';

// Database driver. JSON files on disk stand in for a real database:
// replace this file with a driver of the same shape to switch storage.

const { openStore } = require('highscript/json-store');

const open = ({ options, logger }) =>
  openStore({ directory: options.directory, logger });

module.exports = { open };
