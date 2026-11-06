({
  eventId: 'string',
  gatewayPaymentId: 'string',
  status: { enum: ['created', 'confirmed', 'cancelled', 'refunded'] },
  applied: 'boolean',
  receivedAt: 'string',
  identity: { primary: ['eventId'] },
});
