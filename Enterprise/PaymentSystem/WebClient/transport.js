'use strict';

// Client transport (via) for the Payments API over http-json.

const { createClient } = require('highscript/http-client');

const open = ({ options }) => createClient(options);

module.exports = { open };
