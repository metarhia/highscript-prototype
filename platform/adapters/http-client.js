'use strict';

// Client transport for 'http-json' endpoints, based on fetch.
// Isomorphic: Node.js 18+ and browsers. Used as `via` adapter:
// call('Payments/v2/createPayment', input) -> result or throws { code }.
// Options:
// - token: bearer token; sign(body) -> extra headers (e.g. signatures);
// - errorCode: code for every failure of a remote that is not ours, so its
//   error codes never pass for the caller's own (original error is cause);
// - logger: warns about failures. call('', input) posts to url itself.

class TransportError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.status = status;
  }
}

const request = async (target, path, body, headers, timeoutMs) => {
  let response;
  try {
    response = await fetch(target, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new TransportError(
      'TRANSPORT_FAILURE',
      `${path}: ${error.message}`,
      0,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    const message = `${path}: HTTP ${response.status}`;
    throw new TransportError('TRANSPORT_FAILURE', message, response.status);
  }
  if (payload.error) {
    const { code = 'INTERNAL', message = `HTTP ${response.status}` } =
      payload.error;
    throw new TransportError(code, message, response.status);
  }
  return payload.result;
};

const createClient = ({
  url,
  token = null,
  timeoutMs = 10000,
  sign = null,
  errorCode = null,
  logger = null,
}) => {
  if (typeof url !== 'string' || url === '') throw new Error('Expected url');
  const base = url.replace(/\/+$/, '');

  const call = async (path, input) => {
    const body = JSON.stringify(input ?? {});
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (sign) Object.assign(headers, sign(body));
    const target = path ? `${base}/${path}` : base;
    try {
      return await request(target, path || base, body, headers, timeoutMs);
    } catch (error) {
      logger?.warn(`${path || base}: ${error.code} ${error.message}`);
      if (!errorCode) throw error;
      const message = `${path || base}: ${error.message}`;
      throw Object.assign(new Error(message, { cause: error }), {
        code: errorCode,
      });
    }
  };

  return Object.freeze({ call });
};

module.exports = { createClient, TransportError };
