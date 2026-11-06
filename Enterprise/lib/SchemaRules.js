'use strict';

const positiveMinor = (value) => Number.isSafeInteger(value) && value > 0;
const nonNegativeMinor = (value) => Number.isSafeInteger(value) && value >= 0;
const pageSize = (value) =>
  Number.isSafeInteger(value) && value >= 1 && value <= 100;
const paymentMethodCommand = (value) =>
  value.action === 'list' ||
  (typeof value.methodToken === 'string' && value.methodToken.length > 0);

module.exports = {
  positiveMinor,
  nonNegativeMinor,
  pageSize,
  paymentMethodCommand,
};
