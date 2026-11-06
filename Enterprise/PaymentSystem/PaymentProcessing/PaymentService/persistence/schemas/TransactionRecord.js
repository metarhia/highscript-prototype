({
  transactionId: 'string',
  paymentId: 'string',
  merchantId: 'string',
  kind: { enum: ['create', 'confirm', 'cancel', 'refund'] },
  amountMinor: { type: 'number', validate: lib.SchemaRules.positiveMinor },
  currency: { enum: ['USD', 'EUR', 'UAH'] },
  idempotencyKey: '?string',
  createdAt: 'string',
  identity: { primary: ['transactionId'] },
  request: { unique: ['paymentId', 'idempotencyKey'] },
  merchantHistory: { index: ['merchantId'] },
});
