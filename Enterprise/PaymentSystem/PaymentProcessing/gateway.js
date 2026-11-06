'use strict';

// Adapter to the PaymentGateway API: transport for the remote contract
// stub (via) and local verification of webhook signatures. Every failure of
// the gateway becomes GATEWAY_FAILURE: gateway error codes are not ours.

const { createClient } = require('highscript/http-client');
const { verify } = require('highscript/signature');

const open = ({ options, logger }) => {
  const { url, token, timeoutMs, webhookSecret } = options;
  const { call } = createClient({
    url,
    token,
    timeoutMs,
    logger,
    errorCode: 'GATEWAY_FAILURE',
  });
  const verifyWebhook = ({ headers, body, toleranceSeconds }) =>
    verify({ secret: webhookSecret, headers, body, toleranceSeconds });
  return Object.freeze({ call, verifyWebhook });
};

module.exports = { open };
