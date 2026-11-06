({
  gatewayPaymentId: 'string',
  amountMinor: { type: 'number', validate: lib.SchemaRules.positiveMinor },
  idempotencyKey: 'string',
});
