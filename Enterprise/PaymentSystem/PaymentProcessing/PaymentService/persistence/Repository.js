'use strict';

// Data access layer of PaymentService: payments, their transaction log and
// processed gateway events. Knows nothing about the storage engine except
// the driver interface: collection(name, schema), newId().

const now = () => new Date().toISOString();

const encodeCursor = (offset) =>
  Buffer.from(String(offset)).toString('base64url');

const decodeCursor = (cursor) => {
  if (!cursor) return 0;
  const offset = Number(Buffer.from(cursor, 'base64url').toString());
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw Object.assign(new Error('Invalid cursor'), { code: 'INVALID_INPUT' });
  }
  return offset;
};

const create = async ({ database, payments, transactions, events }) => {
  const [paymentTable, transactionTable, eventTable] = await Promise.all([
    database.collection('payments', payments),
    database.collection('transactions', transactions),
    database.collection('events', events),
  ]);

  const log = (payment, { kind, amountMinor, idempotencyKey }) =>
    transactionTable.insert({
      transactionId: database.newId(),
      paymentId: payment.paymentId,
      merchantId: payment.merchantId,
      kind,
      amountMinor,
      currency: payment.currency,
      idempotencyKey,
      createdAt: now(),
    });

  const insert = async (payment) => {
    const timestamp = now();
    const record = { ...payment, createdAt: timestamp, updatedAt: timestamp };
    const created = await paymentTable.insert(record);
    await log(created, { kind: 'create', amountMinor: created.amountMinor });
    return created;
  };

  // decide(current) returns { changes, kind, amountMinor, idempotencyKey }
  // or null; the check and the update happen atomically.
  const transition = async (paymentId, decide) => {
    let step = null;
    const updated = await paymentTable.modify(paymentId, (current) => {
      step = decide(current);
      return step ? { ...step.changes, updatedAt: now() } : null;
    });
    if (!updated) {
      return { payment: paymentTable.get(paymentId), applied: false };
    }
    await log(updated, step);
    return { payment: updated, applied: true };
  };

  // Newest first: page `offset` from the end of the append-only log.
  const history = (merchantId, { cursor, limit }) => {
    const offset = decodeCursor(cursor);
    const total = transactionTable.count({ merchantId });
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    const page = { offset: start, limit: end - start };
    const items = transactionTable.find({ merchantId }, page).reverse();
    const next = offset + limit;
    return { items, nextCursor: next < total ? encodeCursor(next) : null };
  };

  const registerEvent = async (event) => {
    try {
      await eventTable.insert({ ...event, receivedAt: now() });
      return true;
    } catch (error) {
      if (error.code === 'UNIQUE_VIOLATION') return false;
      throw error;
    }
  };

  return Object.freeze({
    newId: () => database.newId(),
    findById: async (paymentId) => paymentTable.get(paymentId),
    findByIdempotencyKey: async (merchantId, idempotencyKey) =>
      paymentTable.findOne({ merchantId, idempotencyKey }),
    findByGatewayId: async (gatewayPaymentId) =>
      paymentTable.findOne({ gatewayPaymentId }),
    findRequest: async (paymentId, idempotencyKey) =>
      transactionTable.findOne({ paymentId, idempotencyKey }),
    isEventKnown: async (eventId) => eventTable.get(eventId) !== null,
    insert,
    transition,
    history: async (merchantId, page) => history(merchantId, page),
    registerEvent,
  });
};

module.exports = { create };
