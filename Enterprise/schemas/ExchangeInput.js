({
  from: { enum: ['USD', 'EUR', 'UAH'] },
  to: { enum: ['USD', 'EUR', 'UAH'] },
  amountMinor: { type: 'number', validate: lib.SchemaRules.positiveMinor },
});
