'use strict';

// DOM rendering. The payment form is generated from the PaymentForm
// projection: its fields, enum values and ui hints (money, select,
// token-picker).

const h = (tag, props = {}, ...children) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (key === 'value') element.value = value;
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'object' ? child : String(child));
  }
  return element;
};

const money = (minor, currency) => `${(minor / 100).toFixed(2)} ${currency}`;
const short = (id) => id.slice(0, 8);

const mount = (root, controller, styles) => {
  const { state, form } = controller;
  const draft = {
    amount: '25.00',
    currency: 'EUR',
    methodToken: '',
    token: '',
    refund: {},
  };
  const style = h('style', {}, styles);
  document.head.append(style);

  const safely = (action) => (event) => {
    event?.preventDefault?.();
    action().catch(() => {});
  };

  const field = (name) => {
    const descriptor = form.fields[name];
    const hint = form.ui[name];
    const label = (control) => h('label', {}, name, control);
    if (name === 'merchantId') {
      return label(
        h('input', { value: state.merchantId, disabled: true, size: 8 }),
      );
    }
    if (hint === 'money') {
      return label(
        h('input', {
          type: 'number',
          min: '0.01',
          step: '0.01',
          value: draft.amount,
          oninput: (event) => (draft.amount = event.target.value),
        }),
      );
    }
    const values =
      hint === 'token-picker' ? state.methods : descriptor.values || [];
    const key = hint === 'token-picker' ? 'methodToken' : name;
    if (!values.includes(draft[key])) draft[key] = values[0] || '';
    return label(
      h(
        'select',
        { onchange: (event) => (draft[key] = event.target.value) },
        values.map((value) =>
          h('option', { value, selected: value === draft[key] }, value),
        ),
      ),
    );
  };

  const header = () =>
    h(
      'header',
      {},
      h('h1', {}, 'PaymentSystem · WebClient'),
      h(
        'form',
        {
          onsubmit: safely(async () => {
            const input = root.querySelector('#merchant');
            controller.setMerchant(input.value);
            await controller.loadMethods();
            await controller.loadHistory();
          }),
        },
        h(
          'label',
          {},
          'Merchant',
          h('input', { id: 'merchant', value: state.merchantId, size: 8 }),
        ),
        h('button', { class: 'secondary' }, 'Open'),
      ),
    );

  const methodsSection = () =>
    h(
      'section',
      {},
      h('h2', {}, 'Payment methods'),
      h(
        'div',
        { class: 'tokens' },
        state.methods.length === 0
          ? h('span', { class: 'muted' }, 'No methods yet')
          : null,
        state.methods.map((token) =>
          h(
            'span',
            { class: 'token' },
            token,
            ' ',
            h(
              'button',
              {
                class: 'secondary',
                onclick: safely(() => controller.removeMethod(token)),
              },
              '×',
            ),
          ),
        ),
      ),
      h(
        'form',
        { onsubmit: safely(() => controller.addMethod(draft.token)) },
        h(
          'label',
          {},
          'Token',
          h('input', {
            value: draft.token,
            placeholder: 'tok_visa',
            oninput: (event) => (draft.token = event.target.value),
          }),
        ),
        h('button', { disabled: state.busy }, 'Add method'),
      ),
    );

  const paySection = () =>
    h(
      'section',
      {},
      h('h2', {}, 'New payment'),
      h(
        'form',
        {
          onsubmit: safely(() =>
            controller.pay({
              merchantId: state.merchantId,
              amountMinor: Math.round(Number(draft.amount) * 100),
              currency: draft.currency,
              methodToken: draft.methodToken,
            }),
          ),
        },
        Object.keys(form.fields).map(field),
        h(
          'button',
          { disabled: state.busy || state.methods.length === 0 },
          'Pay',
        ),
      ),
    );

  const actions = (payment) => {
    const { paymentId, status } = payment;
    const buttons = [
      h(
        'button',
        {
          class: 'secondary',
          onclick: safely(() => controller.refresh(paymentId)),
        },
        '↻',
      ),
    ];
    if (status === 'created') {
      buttons.push(
        h(
          'button',
          { onclick: safely(() => controller.confirm(paymentId)) },
          'Confirm',
        ),
        h(
          'button',
          {
            class: 'secondary',
            onclick: safely(() => controller.cancel(paymentId)),
          },
          'Cancel',
        ),
      );
    }
    if (status === 'confirmed') {
      const remaining = (payment.amountMinor - payment.refundedMinor) / 100;
      draft.refund[paymentId] ??= remaining.toFixed(2);
      buttons.push(
        h('input', {
          type: 'number',
          step: '0.01',
          size: 6,
          value: draft.refund[paymentId],
          oninput: (event) => (draft.refund[paymentId] = event.target.value),
        }),
        h(
          'button',
          {
            onclick: safely(() =>
              controller.refund(
                paymentId,
                Math.round(Number(draft.refund[paymentId]) * 100),
              ),
            ),
          },
          'Refund',
        ),
      );
    }
    return h('div', { class: 'row' }, buttons);
  };

  const paymentsSection = () =>
    h(
      'section',
      { class: 'scroll' },
      h('h2', {}, 'Payments (this session)'),
      state.payments.length === 0
        ? h('p', { class: 'muted' }, 'Create a payment to see it here')
        : h(
            'table',
            {},
            h(
              'tr',
              {},
              ['Payment', 'Amount', 'Settlement', 'Refunded', 'Status', ''].map(
                (t) => h('th', {}, t),
              ),
            ),
            state.payments.map((payment) =>
              h(
                'tr',
                {},
                h('td', { title: payment.paymentId }, short(payment.paymentId)),
                h('td', {}, money(payment.amountMinor, payment.currency)),
                h(
                  'td',
                  {},
                  money(
                    payment.settlementAmountMinor,
                    payment.settlementCurrency,
                  ),
                ),
                h('td', {}, money(payment.refundedMinor, payment.currency)),
                h('td', { class: 'status' }, payment.status),
                h('td', {}, actions(payment)),
              ),
            ),
          ),
    );

  const historySection = () =>
    h(
      'section',
      { class: 'scroll' },
      h(
        'div',
        { class: 'row' },
        h('h2', {}, 'Transaction history'),
        h(
          'button',
          {
            class: 'secondary',
            onclick: safely(() => controller.loadHistory()),
          },
          'Reload',
        ),
      ),
      h(
        'table',
        {},
        h(
          'tr',
          {},
          ['Time', 'Kind', 'Amount', 'Payment'].map((t) => h('th', {}, t)),
        ),
        state.history.items.map((item) =>
          h(
            'tr',
            {},
            h('td', {}, item.createdAt.replace('T', ' ').slice(0, 19)),
            h('td', {}, item.kind),
            h('td', {}, money(item.amountMinor, item.currency)),
            h('td', { title: item.paymentId }, short(item.paymentId)),
          ),
        ),
      ),
      state.history.nextCursor
        ? h(
            'button',
            {
              class: 'secondary',
              onclick: safely(() => controller.loadHistory({ more: true })),
            },
            'Load more',
          )
        : null,
    );

  const render = () => {
    const message = state.message
      ? h('div', { class: `message ${state.message.type}` }, state.message.text)
      : null;
    const main = h(
      'main',
      {},
      header(),
      message,
      methodsSection(),
      paySection(),
      paymentsSection(),
      historySection(),
    );
    root.replaceChildren(main);
  };

  const unsubscribe = controller.subscribe(render);
  render();
  return () => {
    unsubscribe();
    style.remove();
    root.replaceChildren();
  };
};

module.exports = { mount };
