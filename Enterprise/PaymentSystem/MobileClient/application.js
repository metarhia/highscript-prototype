({
  consumes: {
    payments: { from: PaymentProcessing.server.v1, via: transport },
  },
  exposes: {
    ui: { open: { payments, form: schemas.PaymentForm } },
  },
});
