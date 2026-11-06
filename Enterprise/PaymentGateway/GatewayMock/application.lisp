(consumes
  (webhook (from webhook) (via notifier)))
(exposes
  (server
    (contract contracts.PaymentGateway)
    (transport "http-json")
    (open (options config.server) (logger) (api charges)))
  (operator
    (contract contracts.GatewayOperator)
    (transport "http-json")
    (open (server) (api charges))))
