'use strict';

const { createServer } = require('highscript/http-server');

const open = ({ options, logger, api, contract }) =>
  createServer({ options, logger, api, contract });

module.exports = { open };
