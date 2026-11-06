({
  actors: {
    Customer: { consumes: { WebClient, MobileClient } },
    Merchant: { consumes: { WebClient, Terminal } },
    Administrator: { consumes: { Terminal } },
    Accountant: { consumes: { WebClient } },
  },
  consumes: {
    PaymentGateway: { from: PaymentGateway.api.v1 },
    CurrencyExchange: { from: CurrencyExchange.api.v1 },
  },
  exposes: {
    WebClient,
    MobileClient,
    Terminal,
    PaymentProcessing,
  },
});
