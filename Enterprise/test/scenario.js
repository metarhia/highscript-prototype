'use strict';

// End-to-end scenario shared by the e2e test and the demo
// (highscript up Enterprise --scenario Enterprise/test/scenario.js).
// Actors work through the real WebClient application (its controller,
// assembled in Node.js), the gateway operator uses the operator console;
// all calls cross HTTP between separately assembled applications.

const assert = require('node:assert/strict');
const { setTimeout: sleep } = require('node:timers/promises');

const WEB = 'Enterprise.PaymentSystem.WebClient';
const BACKEND = 'Enterprise.PaymentSystem.PaymentProcessing';
const GATEWAY = 'Enterprise.PaymentGateway.GatewayMock';

const until = async (probe, { timeoutMs = 5000, intervalMs = 25 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result) return result;
    if (Date.now() > deadline) throw new Error('Timeout waiting for condition');
    await sleep(intervalMs);
  }
};

const baseUrl = ({ host, port, basePath = '' }) =>
  `http://${host}:${port}${basePath}`;

const post = async (url, body, headers = {}) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, ...payload };
};

const run = async ({ model, env, highscript, log = () => {} }) => {
  const config = (app, section) =>
    highscript.config(model, app, section, { env });
  const server = config(BACKEND, 'server');
  const api = baseUrl(server);
  const webhookUrl = baseUrl({
    ...server,
    basePath: config(BACKEND, 'webhook').path,
  });
  const gatewayServer = config(GATEWAY, 'server');
  const operator = highscript.connect(model, 'PaymentGateway.operator.v1', {
    url: baseUrl(gatewayServer),
    token: gatewayServer.token,
    env,
  });
  const web = await highscript.assemble(model, WEB, { env });
  await web.start();
  const ui = web.roots.ui.controller;
  const tag = Date.now().toString(36);
  const merchantId = `M-${tag}`;
  const money = (minor, currency) => `${(minor / 100).toFixed(2)} ${currency}`;
  const step = (title, action) => {
    log(`\n▶ ${title}`);
    return action();
  };
  const show = (payment) =>
    log(
      [
        `  ${payment.paymentId.slice(0, 8)}`,
        money(payment.amountMinor, payment.currency),
        `→ ${money(payment.settlementAmountMinor, payment.settlementCurrency)}`,
        `refunded ${money(payment.refundedMinor, payment.currency)}`,
        `[${payment.status}]`,
      ].join(' '),
    );

  try {
    await step(
      `Merchant ${merchantId} opens WebClient and registers payment methods`,
      async () => {
        ui.setMerchant(merchantId);
        await ui.addMethod('tok_visa');
        const tokens = await ui.addMethod('tok_declined');
        assert.deepEqual(tokens, ['tok_visa', 'tok_declined']);
        log(`  methods: ${tokens.join(', ')}`);
      },
    );

    const first = {
      merchantId,
      amountMinor: 2500,
      currency: 'EUR',
      methodToken: 'tok_visa',
    };
    const key = `${tag}-pay-1`;
    const payment = await step(
      'Customer pays 25.00 EUR, settled in USD via CurrencyExchange',
      async () => {
        const created = await ui.pay(first, { idempotencyKey: key });
        assert.equal(created.status, 'created');
        assert.equal(created.settlementCurrency, 'USD');
        assert.equal(created.settlementAmountMinor, 2700);
        assert.match(created.quoteId, /^q_/);
        show(created);
        return created;
      },
    );

    await step(
      'Retry with the same idempotency key returns the same payment',
      async () => {
        const again = await ui.pay(first, { idempotencyKey: key });
        assert.equal(again.paymentId, payment.paymentId);
        await assert.rejects(
          ui.pay({ ...first, amountMinor: 9900 }, { idempotencyKey: key }),
          {
            code: 'IDEMPOTENCY_CONFLICT',
          },
        );
        log(
          '  same paymentId; other amount with this key → IDEMPOTENCY_CONFLICT',
        );
      },
    );

    const { gatewayPaymentId } = payment;
    await step(
      'Merchant confirms; gateway webhook is delivered and acknowledged',
      async () => {
        const confirmed = await ui.confirm(payment.paymentId);
        assert.equal(confirmed.status, 'confirmed');
        const { items } = await until(async () => {
          const list = await operator.listNotifications({ gatewayPaymentId });
          return list.items.some((item) => item.delivered) && list;
        });
        const delivered = items.find((item) => item.status === 'confirmed');
        assert.equal(delivered.accepted, true);
        show(confirmed);
        log(`  webhook ${delivered.eventId.slice(0, 12)}… confirmed: accepted`);
      },
    );

    await step('Merchant refunds 10.00 EUR (partial refund)', async () => {
      const refunded = await ui.refund(payment.paymentId, 1000);
      assert.equal(refunded.status, 'confirmed');
      assert.equal(refunded.refundedMinor, 1000);
      const charge = await operator.getCharge({ gatewayPaymentId });
      assert.equal(charge.refundedMinor, 1080);
      show(refunded);
      log(`  gateway refunded ${money(charge.refundedMinor, charge.currency)}`);
    });

    await step(
      'Gateway operator refunds the rest; webhook updates the payment',
      async () => {
        const charge = await operator.refundCharge({ gatewayPaymentId });
        assert.equal(charge.status, 'refunded');
        const updated = await until(async () => {
          const current = await ui.refresh(payment.paymentId);
          return current.status === 'refunded' && current;
        });
        assert.equal(updated.refundedMinor, 2500);
        show(updated);
      },
    );

    await step(
      'Customer pays 120.00 USD (no conversion) and cancels',
      async () => {
        const second = await ui.pay({
          ...first,
          amountMinor: 12000,
          currency: 'USD',
        });
        assert.equal(second.quoteId, null);
        const cancelled = await ui.cancel(second.paymentId);
        assert.equal(cancelled.status, 'cancelled');
        show(cancelled);
      },
    );

    await step('Declined card is reported as GATEWAY_FAILURE', async () => {
      const declined = { ...first, methodToken: 'tok_declined' };
      await assert.rejects(ui.pay(declined), { code: 'GATEWAY_FAILURE' });
      log(`  ${ui.state.message.text}`);
    });

    await step(
      'Invalid input is rejected on the client and on the server',
      async () => {
        await assert.rejects(ui.pay({ ...first, amountMinor: -5 }), {
          code: 'INVALID_INPUT',
        });
        const extra = {
          ...first,
          idempotencyKey: `${tag}-x`,
          cardNumber: '4111',
        };
        const reply = await post(`${api}/Payments/v2/createPayment`, extra);
        assert.equal(reply.status, 400);
        assert.equal(reply.error.code, 'INVALID_INPUT');
        log(`  server: ${reply.status} ${reply.error.message}`);
      },
    );

    await step(
      'Accountant reads transaction history page by page',
      async () => {
        const page = await ui.loadHistory({ limit: 4 });
        assert.equal(page.items.length, 4);
        assert.ok(page.nextCursor);
        await ui.loadHistory({ more: true, limit: 4 });
        const kinds = ui.state.history.items.map((item) => item.kind);
        assert.deepEqual([...kinds].sort(), [
          'cancel',
          'confirm',
          'create',
          'create',
          'refund',
          'refund',
        ]);
        assert.equal(ui.state.history.nextCursor, null);
        log(`  newest first: ${kinds.join(', ')}`);
      },
    );

    await step(
      'API versions: v1 clients get the v1 Payment shape',
      async () => {
        const query = { paymentId: payment.paymentId };
        const v1 = await post(`${api}/Payments/v1/getPaymentStatus`, query);
        const v2 = await post(`${api}/Payments/v2/getPaymentStatus`, query);
        assert.deepEqual(Object.keys(v1.result).sort(), [
          'amountMinor',
          'currency',
          'gatewayPaymentId',
          'merchantId',
          'paymentId',
          'status',
        ]);
        assert.equal(v2.result.settlementCurrency, 'USD');
        log(
          `  fields: v1 ${Object.keys(v1.result).length}, ` +
            `v2 ${Object.keys(v2.result).length}`,
        );
      },
    );

    await step('Unsigned webhook is rejected', async () => {
      const forged = {
        eventId: 'evt_forged',
        gatewayPaymentId,
        status: 'cancelled',
      };
      const reply = await post(webhookUrl, forged);
      assert.equal(reply.status, 401);
      log(`  ${reply.status} ${reply.error.code}`);
    });
  } finally {
    await web.close();
  }
};

module.exports = { run };
