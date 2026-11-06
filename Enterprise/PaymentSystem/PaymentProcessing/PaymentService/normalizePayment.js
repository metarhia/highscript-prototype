'use strict';

const create = () => (input) => ({
  ...input,
  merchantId: input.merchantId.trim(),
  currency: input.currency.toUpperCase(),
});

module.exports = { create };
