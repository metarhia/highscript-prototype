({
  gatewayPaymentId: 'string',
  status: { enum: ['created', 'confirmed', 'cancelled', 'refunded'] },
  refundedMinor: { type: 'number', validate: lib.SchemaRules.nonNegativeMinor },
});
