'use strict';

// Webhook delivery transport (via): posts signed notifications to the
// merchant webhook URL itself, the contract path is not appended.

const { createClient } = require('highscript/http-client');
const { sign } = require('highscript/signature');

const open = ({ options }) => {
  const { url, secret, timeoutMs } = options;
  const client = createClient({
    url,
    timeoutMs,
    sign: (body) => sign({ secret, body }),
  });
  return Object.freeze({ call: (path, input) => client.call('', input) });
};

module.exports = { open };
