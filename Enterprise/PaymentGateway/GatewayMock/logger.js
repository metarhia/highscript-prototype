'use strict';

const { openLogger } = require('highscript/logger');

const open = ({ options }) => openLogger(options);

module.exports = { open };
