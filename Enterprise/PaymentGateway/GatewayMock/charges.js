'use strict';

// Mock payment gateway: charges with an authorize/confirm/cancel/refund
// lifecycle, merchant payment methods, operator refunds and webhook
// notifications with retries. State is kept in JSON collections.

const fail = (code, message) => Object.assign(new Error(message), { code });

const now = () => new Date().toISOString();

const requireStatus = (charge, status) => {
  if (charge.status !== status) {
    throw fail('INVALID_STATE', `Charge is ${charge.status}`);
  }
};

const receipt = ({ gatewayPaymentId, status, refundedMinor }) => ({
  gatewayPaymentId,
  status,
  refundedMinor,
});

const open = async ({ options, database, schemas, webhook, logger }) => {
  const [charges, methods, notifications] = await Promise.all([
    database.collection('charges', schemas.ChargeRecord),
    database.collection('methods', schemas.MethodRecord),
    database.collection('notifications', schemas.NotificationRecord),
  ]);
  const timers = new Set();
  const deliveries = new Set();
  let closing = false;

  // Runs a background task later; close() cancels timers and awaits tasks.
  const later = (task, delay) => {
    if (closing) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      const running = task()
        .catch((error) => logger.error(error.message))
        .finally(() => deliveries.delete(running));
      deliveries.add(running);
    }, delay);
    timers.add(timer);
  };

  const deliver = async (eventId) => {
    const record = notifications.get(eventId);
    const { gatewayPaymentId, status } = record;
    const attempts = record.attempts + 1;
    try {
      const { accepted } = await webhook({ eventId, gatewayPaymentId, status });
      await notifications.update(eventId, {
        attempts,
        delivered: true,
        accepted,
        lastError: null,
      });
    } catch (error) {
      await notifications.update(eventId, {
        attempts,
        lastError: error.message,
      });
      if (attempts < options.retries) {
        later(() => deliver(eventId), options.retryDelayMs * attempts);
      } else {
        logger.warn(`notification ${eventId} failed: ${error.message}`);
      }
    }
  };

  const notify = async (charge) => {
    const eventId = `evt_${database.newId()}`;
    await notifications.insert({
      eventId,
      gatewayPaymentId: charge.gatewayPaymentId,
      status: charge.status,
      attempts: 0,
      delivered: false,
      createdAt: now(),
    });
    later(() => deliver(eventId), options.delayMs);
  };

  const find = (gatewayPaymentId) => {
    const charge = charges.get(gatewayPaymentId);
    if (!charge) {
      throw fail('PAYMENT_NOT_FOUND', `Charge ${gatewayPaymentId} not found`);
    }
    return charge;
  };

  // Applies a change atomically; notifies only when state really changed
  // (modify returns null when decide returns null).
  const change = async (gatewayPaymentId, decide) => {
    const updated = await charges.modify(gatewayPaymentId, decide);
    if (updated) await notify(updated);
    return updated || find(gatewayPaymentId);
  };

  const transition = (from, to) => (current) => {
    if (current.status === to) return null;
    requireStatus(current, from);
    return { status: to };
  };

  const authorize = async (input) => {
    const { merchantId, idempotencyKey, methodToken } = input;
    const existing = charges.findOne({ merchantId, idempotencyKey });
    if (existing) return receipt(existing);
    const tokens = methods.get(merchantId)?.tokens ?? [];
    if (!tokens.includes(methodToken)) {
      throw fail('GATEWAY_FAILURE', 'Payment method is not registered');
    }
    if (options.declinedTokens.includes(methodToken)) {
      throw fail('GATEWAY_FAILURE', 'Card declined');
    }
    const charge = await charges.insert({
      ...input,
      gatewayPaymentId: `gw_${database.newId()}`,
      status: 'created',
      refundedMinor: 0,
      refundKeys: [],
      createdAt: now(),
    });
    logger.info(
      `charge ${charge.gatewayPaymentId} authorized ${charge.amountMinor}`,
    );
    return receipt(charge);
  };

  const confirm = async ({ gatewayPaymentId }) =>
    receipt(await change(gatewayPaymentId, transition('created', 'confirmed')));

  const cancel = async ({ gatewayPaymentId }) =>
    receipt(await change(gatewayPaymentId, transition('created', 'cancelled')));

  const refund = async ({ gatewayPaymentId, amountMinor, idempotencyKey }) => {
    const charge = await change(gatewayPaymentId, (current) => {
      if (current.refundKeys.includes(idempotencyKey)) return null;
      requireStatus(current, 'confirmed');
      const refundedMinor = current.refundedMinor + amountMinor;
      if (refundedMinor > current.amountMinor) {
        throw fail('INVALID_INPUT', 'Refund exceeds charged amount');
      }
      const status =
        refundedMinor === current.amountMinor ? 'refunded' : 'confirmed';
      return {
        status,
        refundedMinor,
        refundKeys: [...current.refundKeys, idempotencyKey],
      };
    });
    return receipt(charge);
  };

  const manageMethods = async ({ merchantId, action, methodToken }) => {
    const current = methods.get(merchantId);
    let tokens = current?.tokens ?? [];
    if (action === 'add' && !tokens.includes(methodToken)) {
      tokens = [...tokens, methodToken];
    }
    if (action === 'remove') {
      tokens = tokens.filter((token) => token !== methodToken);
    }
    if (action !== 'list') {
      if (current) await methods.update(merchantId, { tokens });
      else await methods.insert({ merchantId, tokens });
    }
    return { tokens };
  };

  // Operator console: what gateway staff can see and do.
  const getCharge = async ({ gatewayPaymentId }) => find(gatewayPaymentId);

  const refundCharge = async ({ gatewayPaymentId }) =>
    change(gatewayPaymentId, (current) => {
      requireStatus(current, 'confirmed');
      return { status: 'refunded', refundedMinor: current.amountMinor };
    });

  const listNotifications = async ({ gatewayPaymentId }) => {
    const filter = gatewayPaymentId ? { gatewayPaymentId } : {};
    return { items: notifications.find(filter) };
  };

  const close = async () => {
    closing = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    await Promise.allSettled([...deliveries]);
  };

  return Object.freeze({
    authorize,
    confirm,
    cancel,
    refund,
    manageMethods,
    getCharge,
    refundCharge,
    listNotifications,
    close,
  });
};

module.exports = { open };
