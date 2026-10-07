({
  domain: {
    order: {
      create: {},
    },
  },
  infrastructure: {
    config: {
      open: { fileName: 'configuration.json' },
    },
    logger: {
      open: { fileName: infrastructure.config.read('logger') },
    },
    cli: {
      init: {},
    },
    server: {
      create: {
        console: infrastructure.logger.getInstance(),
        options: infrastructure.config.read('server'),
      },
    },
  },
  application: {
    products: { getInstance: {} },
    orders: { getInstance: {} },
    purchase: {
      placeOrder: {
        order: domain.order.create(),
        catalog: application.products.getInstance(),
        orders: application.orders.getInstance(),
      },
    },
  },
  presentation: {
    terminal: infrastructure.cli.on('call', {
      order: application.purchase.placeOrder,
    }),
    api: infrastructure.server.on('call', {
      order: application.purchase.placeOrder,
    }),
  },
});
