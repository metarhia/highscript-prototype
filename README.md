# Highscript v0.2.x

> Highscript self-similarity

Architectural DSL where every level (enterprise, solution, application,
service, component) has the same structure: `actors`, `consumes`, `exposes`.
The project is one folder hierarchy; names of parts come from the code
structure; dependencies are injected explicitly; contracts guard boundaries.

- `specs/` — specification: `SPEC.md`
- `platform/` — engine: parser, loader, planner, runtime, adapters, CLI
- `Enterprise/` — example: PaymentSystem and mock PaymentGateway,
  CurrencyExchange
- `Enterprise/docs/` — architecture diagrams generated from the example DSL

## Run

Node.js 22 or newer, no dependencies for running (eslint and prettier only
for `npm run lint`).

```sh
npm test        # platform, unit, repository, UI and end-to-end tests
npm run check   # check architecture: errors, warnings, hints
npm run scaffold # generate missing structure and templates from DSL
npm run diagram # draw diagrams from DSL into Enterprise/docs/architecture.md
npm run demo    # start everything and run the narrated scenario
npm start       # start everything, then open http://127.0.0.1:8000/
```

`npm start` and `npm run demo` start, in one process, the mock gateway
(`:7081`), the mock exchange (`:7082`), PaymentProcessing (`:7080`) and serve
the WebClient bundle (`:8000`). Data is written as JSON files to
`.data/<environment>/`. Tests use the `test` environment (ports `17080`–`18000`,
`.data/test/`). Single applications:

```sh
node platform/bin/highscript.js start Enterprise/PaymentSystem/PaymentProcessing
node platform/bin/highscript.js serve Enterprise/PaymentSystem/WebClient
node platform/bin/highscript.js check Enterprise --env production
```

## Diagrams

`Enterprise/docs/architecture.md` is drawn from the DSL (Mermaid, rendered
by GitHub and most Markdown viewers): a landscape of the enterprise down to
applications and a view of every unit with its parts, actors, the parts of the
model it meets and the calls between them. The same view fits every level.

```sh
node platform/bin/highscript.js diagram --out dist/architecture.html
node platform/bin/highscript.js diagram Enterprise/PaymentSystem --depth 2
```

## DSL syntaxes and scaffolding

Every DSL file (level file, contract, schema) can be written in JS, Lisp or
Markdown, chosen by extension; the example mixes all three (`PaymentGateway`
is Lisp, `CurrencyExchange` is Markdown). From DSL files the scaffolder creates
missing units, module templates and config sections; existing files are never
changed.

```sh
node platform/bin/highscript.js print Enterprise/PaymentSystem/solution.js --to md
node platform/bin/highscript.js convert Enterprise/CurrencyExchange --to lisp
node platform/bin/highscript.js scaffold --dry
node platform/bin/highscript.js init Shop --level solution --syntax md
```

## Example

```
Enterprise/                       enterprise.js, contracts and schemas shared by solutions
  PaymentSystem/                  solution.js: actors, consumes gateway and exchange
    contracts/Payments/v1.js v2.js   versioned client-server API
    PaymentProcessing/            application: server, webhook, adapters, config
      PaymentService/             service: operations with contracts
        persistence/              component: Repository over a JSON-file driver
    WebClient/                    application: browser UI, pinned to Payments v2
    MobileClient/ Terminal/       design-only applications, pinned to Payments v1
  PaymentGateway/GatewayMock/     mock gateway (DSL in Lisp): charges, signed webhooks
  CurrencyExchange/ExchangeMock/  mock exchange (DSL in Markdown): rates, quotes
  docs/architecture.md            diagrams generated from the DSL
  test/scenario.js                end-to-end scenario for the demo and the tests
```

The scenario: a merchant registers payment methods, a customer pays in EUR
(settled in USD through the exchange), a retry is idempotent, the merchant
confirms (the gateway webhook is acknowledged), refunds partially, the gateway
operator refunds the rest (the webhook updates the payment), a second payment
is cancelled, a declined card and invalid input are rejected, the accountant
pages through the history, v1 and v2 clients see their versions of `Payment`,
an unsigned webhook is refused.
