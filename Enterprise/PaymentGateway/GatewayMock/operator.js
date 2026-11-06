'use strict';

// Mounts the operator console interface on the gateway HTTP server.

const open = ({ server, api, contract }) => {
  server.mount({ contract, api });
  return Object.freeze({ interface: contract.name });
};

module.exports = { open };
