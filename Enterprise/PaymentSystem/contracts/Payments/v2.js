({
  createPayment: {
    input: schemas.PaymentInput,
    output: schemas.Payment.v2,
    errors: schemas.PaymentError,
  },
  confirmPayment: {
    input: schemas.PaymentRef,
    output: schemas.Payment.v2,
    errors: schemas.PaymentError,
  },
  cancelPayment: {
    input: schemas.PaymentRef,
    output: schemas.Payment.v2,
    errors: schemas.PaymentError,
  },
  refundPayment: {
    input: schemas.RefundInput,
    output: schemas.Payment.v2,
    errors: schemas.PaymentError,
  },
  getPaymentStatus: {
    input: schemas.PaymentQuery,
    output: schemas.Payment.v2,
    errors: schemas.PaymentError,
  },
  getTransactionHistory: contracts.Payments.v1.getTransactionHistory,
  managePaymentMethods: contracts.Payments.v1.managePaymentMethods,
});
