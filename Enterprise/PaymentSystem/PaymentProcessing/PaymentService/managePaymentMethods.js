'use strict';

const create =
  ({ gateway }) =>
  (command) =>
    gateway.manageMethods(command);

module.exports = { create };
