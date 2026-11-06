({
  consumes: {
    payments: { from: PaymentProcessing.server.v1, via: transport },
  },
  exposes: {
    cli: { open: { payments, output } },
  },
});
