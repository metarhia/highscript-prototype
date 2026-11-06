({
  consumes: {
    payments: { from: PaymentProcessing.server.v2, via: transport },
  },
  exposes: {
    ui: { open: { payments, form: schemas.PaymentForm } },
  },
});
