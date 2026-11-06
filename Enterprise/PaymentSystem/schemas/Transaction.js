({
  transactionId: 'string',
  paymentId: 'string',
  merchantId: 'string',
  kind: { enum: ['create', 'confirm', 'cancel', 'refund'] },
  amountMinor: { type: 'number', validate: lib.SchemaRules.positiveMinor },
  currency: { enum: ['USD', 'EUR', 'UAH'] },
  createdAt: 'string',
});
