({
  paymentId: 'string',
  merchantId: 'string',
  amountMinor: { type: 'number', validate: lib.SchemaRules.positiveMinor },
  currency: { enum: ['USD', 'EUR', 'UAH'] },
  status: { enum: ['created', 'confirmed', 'cancelled', 'refunded'] },
  gatewayPaymentId: 'string',
  refundedMinor: { type: 'number', validate: lib.SchemaRules.nonNegativeMinor },
  settlementAmountMinor: {
    type: 'number',
    validate: lib.SchemaRules.positiveMinor,
  },
  settlementCurrency: { enum: ['USD', 'EUR', 'UAH'] },
  quoteId: '?string',
  createdAt: 'string',
  updatedAt: 'string',
});
