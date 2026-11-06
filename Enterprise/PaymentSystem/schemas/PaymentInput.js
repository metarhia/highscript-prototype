({
  merchantId: 'string',
  amountMinor: { type: 'number', validate: lib.SchemaRules.positiveMinor },
  currency: { enum: ['USD', 'EUR', 'UAH'] },
  methodToken: 'string',
  idempotencyKey: 'string',
});
