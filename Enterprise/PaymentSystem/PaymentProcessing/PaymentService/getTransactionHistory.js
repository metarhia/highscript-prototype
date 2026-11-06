'use strict';

const create =
  ({ payments }) =>
  async ({ merchantId, cursor, limit }) =>
    payments.history(merchantId.trim(), { cursor, limit });

module.exports = { create };
