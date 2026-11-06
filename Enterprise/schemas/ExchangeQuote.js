({
  quoteId: 'string',
  amountMinor: { type: 'number', validate: lib.SchemaRules.positiveMinor },
  currency: { enum: ['USD', 'EUR', 'UAH'] },
  expiresAt: 'string',
});
