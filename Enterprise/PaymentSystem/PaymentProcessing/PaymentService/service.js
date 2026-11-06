({
  consumes: { PaymentGateway, CurrencyExchange, logger },
  exposes: {
    createPayment: {
      contract: contracts.Payments.v2.createPayment,
      create: {
        payments: persistence.Repository,
        gateway: PaymentGateway,
        exchange: CurrencyExchange,
        normalize: normalizePayment,
        settlement: config.settlement,
        logger,
      },
    },
    confirmPayment: {
      contract: contracts.Payments.v2.confirmPayment,
      create: {
        payments: persistence.Repository,
        gateway: PaymentGateway,
        logger,
      },
    },
    cancelPayment: {
      contract: contracts.Payments.v2.cancelPayment,
      create: {
        payments: persistence.Repository,
        gateway: PaymentGateway,
        logger,
      },
    },
    refundPayment: {
      contract: contracts.Payments.v2.refundPayment,
      create: {
        payments: persistence.Repository,
        gateway: PaymentGateway,
        logger,
      },
    },
    getPaymentStatus: {
      contract: contracts.Payments.v2.getPaymentStatus,
      create: { payments: persistence.Repository },
    },
    getTransactionHistory: {
      contract: contracts.Payments.v2.getTransactionHistory,
      create: { payments: persistence.Repository },
    },
    managePaymentMethods: {
      contract: contracts.Payments.v2.managePaymentMethods,
      create: { gateway: PaymentGateway },
    },
    handleWebhook: {
      contract: contracts.handleWebhook,
      create: { payments: persistence.Repository, logger },
    },
  },
});
