(actors
  (Operator
    (consumes (operator))))
(consumes
  (webhook (from PaymentSystem.PaymentProcessing.webhook)))
(exposes
  (api GatewayMock.server)
  (operator GatewayMock.operator))
