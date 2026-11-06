({
  consumes: {
    PaymentGateway: { from: PaymentGateway, via: gateway },
    CurrencyExchange: { from: CurrencyExchange, via: exchange },
  },
  exposes: {
    server: {
      contract: contracts.Payments,
      transport: 'http-json',
      open: { options: config.server, logger, api: PaymentService },
    },
    webhook: {
      contract: contracts.handleWebhook,
      transport: 'http-webhook',
      open: {
        server,
        options: config.webhook,
        logger,
        handler: PaymentService.handleWebhook,
        verify: gateway.verifyWebhook,
      },
    },
  },
});
