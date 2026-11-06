({
  merchantId: 'string',
  action: { enum: ['add', 'remove', 'list'] },
  methodToken: '?string',
  validate: lib.SchemaRules.paymentMethodCommand,
});
