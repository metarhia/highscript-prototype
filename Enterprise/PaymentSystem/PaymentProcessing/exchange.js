'use strict';

// Adapter to the CurrencyExchange API (via); its failures are EXCHANGE_FAILURE.

const { createClient } = require('highscript/http-client');

const open = ({ options, logger }) =>
  createClient({ ...options, logger, errorCode: 'EXCHANGE_FAILURE' });

module.exports = { open };
