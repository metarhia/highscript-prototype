({
  authorize: {
    input: schemas.GatewayCharge,
    output: schemas.GatewayReceipt,
    errors: schemas.PaymentError,
  },
  confirm: {
    input: schemas.GatewayRef,
    output: schemas.GatewayReceipt,
    errors: schemas.PaymentError,
  },
  cancel: {
    input: schemas.GatewayRef,
    output: schemas.GatewayReceipt,
    errors: schemas.PaymentError,
  },
  refund: {
    input: schemas.GatewayRefund,
    output: schemas.GatewayReceipt,
    errors: schemas.PaymentError,
  },
  manageMethods: {
    input: schemas.PaymentMethodsInput,
    output: schemas.PaymentMethodsResult,
    errors: schemas.PaymentError,
  },
});
