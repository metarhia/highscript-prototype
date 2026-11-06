'use strict';

// Signed webhook entry: an http-json endpoint at its own path where the
// signature of the raw body replaces bearer authorization.

const open = ({ server, options, logger, handler, verify, contract }) => {
  const { path, toleranceSeconds } = options;
  const signed = (request) => {
    const valid = verify({ ...request, toleranceSeconds });
    if (!valid) logger.warn('webhook rejected: bad signature');
    return valid;
  };
  server.mount({ contract, api: handler, path, verify: signed });
  return Object.freeze({ path });
};

module.exports = { open };
