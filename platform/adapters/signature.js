'use strict';

// HMAC-SHA256 signatures for webhooks: signed text is `${timestamp}.${body}`.

const { createHmac, timingSafeEqual } = require('node:crypto');

const HEADER_SIGNATURE = 'x-signature';
const HEADER_TIMESTAMP = 'x-timestamp';

const digest = (secret, timestamp, body) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

const sign = ({ secret, body, timestamp = Math.floor(Date.now() / 1000) }) => ({
  [HEADER_TIMESTAMP]: String(timestamp),
  [HEADER_SIGNATURE]: digest(secret, timestamp, body),
});

const verify = ({ secret, headers, body, toleranceSeconds = 300 }) => {
  const timestamp = Number(headers[HEADER_TIMESTAMP]);
  const signature = String(headers[HEADER_SIGNATURE] || '');
  if (!Number.isSafeInteger(timestamp) || signature.length !== 64) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;
  const expected = Buffer.from(digest(secret, timestamp, body), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

module.exports = { sign, verify, HEADER_SIGNATURE, HEADER_TIMESTAMP };
