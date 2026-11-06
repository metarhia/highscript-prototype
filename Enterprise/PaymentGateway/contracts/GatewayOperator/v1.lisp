(getCharge
  (input schemas.ChargeQuery)
  (output schemas.Charge)
  (errors schemas.PaymentError))
(refundCharge
  (input schemas.ChargeQuery)
  (output schemas.Charge)
  (errors schemas.PaymentError))
(listNotifications
  (input schemas.NotificationQuery)
  (output schemas.NotificationList)
  (errors schemas.PaymentError))
