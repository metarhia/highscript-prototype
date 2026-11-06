({
  Projection: {
    schema: 'PaymentInput',
    fields: ['merchantId', 'amountMinor', 'currency', 'methodToken'],
    ui: {
      amountMinor: 'money',
      currency: 'select',
      methodToken: 'token-picker',
    },
  },
});
