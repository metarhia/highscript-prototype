({
  consumes: { logger },
  exposes: {
    Repository: {
      create: {
        database,
        payments: schemas.PaymentRecord,
        transactions: schemas.TransactionRecord,
        events: schemas.EventRecord,
      },
    },
  },
});
