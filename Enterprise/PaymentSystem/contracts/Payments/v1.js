({
  createPayment: {
    input: schemas.PaymentInput,
    output: schemas.Payment.v1,
    errors: schemas.PaymentError,
  },
  confirmPayment: {
    input: schemas.PaymentRef,
    output: schemas.Payment.v1,
    errors: schemas.PaymentError,
  },
  cancelPayment: {
    input: schemas.PaymentRef,
    output: schemas.Payment.v1,
    errors: schemas.PaymentError,
  },
  refundPayment: {
    input: schemas.RefundInput,
    output: schemas.Payment.v1,
    errors: schemas.PaymentError,
  },
  getPaymentStatus: {
    input: schemas.PaymentQuery,
    output: schemas.Payment.v1,
    errors: schemas.PaymentError,
  },
  getTransactionHistory: {
    input: schemas.HistoryQuery,
    output: schemas.HistoryPage,
    errors: schemas.PaymentError,
  },
  managePaymentMethods: {
    input: schemas.PaymentMethodsInput,
    output: schemas.PaymentMethodsResult,
    errors: schemas.PaymentError,
  },
});
