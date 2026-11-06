# Highscript self-similar architecture DSL, version 0.2

Status: specification of the implemented engine (`platform/`), November 5, 2026.
The Russian version (`SPEC.ru.md`) defines the same rules. The example project
is `Enterprise/`; this document quotes only short fragments of it.

## 1. Principles

- Architecture is data. A project is one folder hierarchy; a folder is an
  architectural unit; DSL, code, configuration, contracts and schemas of a unit
  live in its folder. There are no parallel trees.
- Self-similarity: every level uses the same grammar (`actors`, `consumes`,
  `exposes`) and the same boundary rules. Level names add meaning and checks,
  not new syntax.
- Names come from the code structure. A unit has no `contains`: its parts are
  its files and subfolders, its public interface is `exposes`, everything else
  is private.
- Dependency injection is explicit: a component receives capabilities only
  through the argument of its factory. Code files do not import each other.
- Boundaries are checked: an exposed capability with a contract validates input
  and output; remote calls cross only declared endpoints.
- Where code runs is a deployment decision, not a DSL field: the same assembly
  plan runs in Node.js or as a browser bundle.
- Diagrams, the architecture check and scaffolding are computed from the
  model: there is no second description of the architecture to keep in sync.

## 2. Levels

- **enterprise** — file `enterprise.js`, alias `landscape.js`. Solutions of
  an organization and contracts shared by them. Example: `Enterprise`.
- **solution** — file `solution.js`, alias `system.js`. Actors, external
  dependencies and applications of a system. Example: `PaymentSystem`, mocks.
- **application** — file `application.js`, alias `subsystem.js`. Deployable
  unit: own process or bundle, own configuration. Example:
  `PaymentProcessing`, `WebClient`.
- **service** — file `service.js`, alias `module.js`. Cohesive set of
  operations with contracts (bounded context). Example: `PaymentService`.
- **component** — file `component.js`, no alias. Composite component:
  components behind a common boundary. Example: `persistence`.
- No level name — file `name.js`, no alias. Leaf component: a code file with
  one factory. Example: `createPayment`, `database`.

Rules:

1. A unit folder contains exactly one level file. The folder name is the unit
   name, the file name is its level. An alias is equivalent to the main name;
   both are reserved in that folder.
2. Levels nest downwards and may be skipped (`GatewayMock` is an application
   with components and no service). `component` nests in `component`. An
   application cannot contain an application.
3. Enterprise and solution are logical levels: no code components there, only
   contracts, schemas and `lib`. Code starts at application level.
4. Any level can be the root of a project. The root is found by walking up
   while the parent folder has a level file.

The five levels follow known models: enterprise, solution and application as in
TOGAF, application as a C4 container, service as a DDD bounded context,
component as a C4 component. Finer structure is nested components, not new
levels.

## 3. Unit folder

- `<level>.js`, `<level>.lisp` or `<level>.md` — DSL file of the unit.
  Allowed in every unit.
- `Name/` with a level file — child unit. Allowed in every unit.
- `name.js` — leaf component. Allowed in an application and below.
- `name/name.js` — leaf component made of several files. Allowed in an
  application and below.
- `config/*.json` — configuration sections, environments. Allowed in an
  application.
- `contracts/` — contracts: file or version files, any syntax. Allowed in
  every unit.
- `schemas/` — schemas: file or version files, any syntax. Allowed in every
  unit.
- `lib/*.js` — pure shared code without DI. Allowed in every unit.
- `test/` — tests of the unit. Allowed in every unit.
- `docs/` — generated diagrams, not loaded. Allowed in every unit.

Names `config`, `contracts`, `schemas`, `lib`, `test`, `docs` and level file
names are reserved: a component cannot use them (hence the client root
component is `ui`, not `application`). Files other than `.js` and dot-files
are ignored. A folder that has neither a level file nor a same-named `.js`
file is an error.

An application without any code file in its subtree is design-only: the check
reports its unresolved names as warnings and `up` skips it (`MobileClient`,
`Terminal` in the example).

## 4. Source format and syntaxes

A DSL file (level file, contract, schema) is written in one of three
syntaxes, chosen by its extension: `.js`, `.lisp` or `.md`. All three give the
same value; the loader parses them and never executes them. Syntaxes can be
mixed in one model: in the example `PaymentGateway` is written in Lisp,
`CurrencyExchange` in Markdown and the rest in JS. A definition has exactly one
file: `application.js` next to `application.md`, or `v1.js` next to
`v1.lisp`, is an error.

JS is one parenthesized object literal: `({ ... });`. Identifiers and
identifier chains are references; strings, numbers, booleans, `null`, arrays
and objects are data. Shorthand properties (`{ WebClient }` means
`{ WebClient: WebClient }`), comments and trailing commas are allowed. Calls,
operators, functions and imports are not. Duplicate keys are errors.

Lisp and Markdown write the same object as a tree of entries. An entry is a
key, at most one value word and nested entries:

- JS `{ WebClient }` — Lisp `(WebClient)` — Markdown `- WebClient`.
- JS `{ api: PaymentService }` — Lisp `(api PaymentService)` — Markdown
  `- api PaymentService`.
- JS `{ transport: 'http-json' }` — Lisp `(transport "http-json")` — Markdown
  `- transport "http-json"`.
- JS `{ ui: {} }` — Lisp `(ui {})` — Markdown `- ui {}`.
- JS `{ enum: ['USD', 'EUR'] }` — Lisp `(enum ["USD" "EUR"])` — Markdown
  `- enum ["USD" "EUR"]`.
- JS `{ open: { logger } }` — Lisp `(open (logger))` — Markdown `- open` with
  a nested `  - logger`.

Words are references `a.b.c`, strings in double or single quotes, numbers,
`true`, `false`, `null`, arrays in `[ ]` separated by spaces and the empty
object `{}`. An entry with neither value nor nested entries is the shorthand
`name: name`, so an empty object is written `{}`; several value words are an
error, arrays need brackets. A Lisp file is a sequence of entries, `;` starts
a comment. A Markdown file is a list nested by two spaces; blank lines and `#`
headings are ignored, so a Markdown DSL file can carry a title. Keys are
identifiers: values that Lisp and Markdown cannot represent (quoted keys,
objects inside arrays) stay in JS.

```lisp
(consumes (webhook (from webhook) (via notifier)))
(exposes
  (server
    (contract contracts.PaymentGateway)
    (transport "http-json")
    (open (options config.server) (logger) (api charges))))
```

```md
- exposes
  - server
    - contract contracts.CurrencyExchange
    - transport "http-json"
    - open
      - options config.server
      - logger
      - api rates
```

`highscript convert <unit|file> --to lisp` rewrites the DSL files of a unit
tree. Every file is formatted, parsed back and compared before any file is
replaced, so conversion cannot change the model. `highscript print <file> --to
md` shows a file in another syntax without changing it.

## 5. DSL file

```js
({
  actors: {}, // who uses exposes of this unit from outside
  consumes: {}, // what the unit gets from outside
  exposes: {}, // public interface of the unit
});
```

All sections are optional; any other section (for example `runtime`) is an
error.

### 5.1 exposes

- `WebClient` — publish a child as is.
- `api: GatewayMock.server` — re-export an exposed element of a child.
- `getPaymentStatus: { contract: contracts.Payments.v2.getPaymentStatus, create: { payments } }`
  — component with contract and explicit ports.
- `server: { contract, transport: 'http-json', open: { ... } }` — endpoint:
  contract plus transport.
- `ui: {}` — component wired by names.

An object entry names a child component with the same name. Besides `contract`
and `transport` it may have one factory map: its key (`create`, `open`, ...) is
the exported factory, its value maps ports to references or data. Everything
not in `exposes` is private: `X.y` from outside X is valid only when `y` is in
X's `exposes`.

An entry with `contract` and without `transport` is guarded: an operation
contract wraps the function (input check, output projection and check); an
interface contract keeps only declared operations and guards each. An entry
with `transport` is an endpoint adapter: its contract describes the remote
interface for the adapter and for remote consumers.

### 5.2 consumes

`consumes` lists everything the unit gets from outside. The key is the local
name inside the unit; the value is resolved in the parent's scope.

- `logger` — take `logger` from the parent's scope.
- `PaymentGateway: { contract: contracts.PaymentGateway.v1 }` — external
  requirement described by a contract.
- `PaymentGateway: { from: PaymentGateway.api.v1 }` — requirement bound to an
  endpoint (logical levels).
- `payments: { from: PaymentProcessing.server.v2, via: transport }` — remote
  binding: endpoint in parent scope, local adapter.

Intermediate units repeat `consumes` explicitly, so every DSL file shows all
links through its boundary and a unit can be moved or checked alone. A chain
of `from` entries is followed up to an exposed endpoint or a `{ contract }`
requirement. `via` is resolved in the unit's own scope and must be a component
of the same application. Clients and backends use the same form: the client
reaches the server through `transport`, the backend reaches the gateway through
`gateway`.

### 5.3 actors

Actors are external participants (people or systems that are not modeled as
units). `consumes` of an actor references keys of `exposes` of the same unit.
Actors are declared once, at the level where their `consumes` is meaningful;
coarser views are derived. Modeled units relate through `consumes`, not
`actors` (the gateway mock consumes the PaymentProcessing webhook).

### 5.4 Scopes

- In `exposes`, `via` and factory ports: children, `consumes` keys,
  namespaces of the unit.
- In `consumes` values and `from`: children and `consumes` keys of the
  parent.
- In `actors`: keys of `exposes` of the unit.
- Member `X.y` of a unit: only `exposes` of X.
- Member `c.method` of a component: members of the component's result
  (receiver is kept).
- `contracts`, `schemas`, `lib`: the unit and all its ancestors (lexical).
- `config`: sections of the enclosing application.

A name that is both a child and a `consumes` key is an error. A definition in
`contracts`, `schemas` or `lib` that repeats a name of an enclosing unit is an
error (no shadowing).

## 6. Components and wiring

A component file is CommonJS with one exported factory. `create` builds a
function or an object; `open` acquires a resource and returns an object with
`close()`. A factory takes one destructured object of ports and may be async.

```js
const create =
  ({ payments }) =>
  async ({ paymentId }) => {
    const payment = await payments.findById(paymentId);
    if (!payment)
      throw Object.assign(new Error('Not found'), {
        code: 'PAYMENT_NOT_FOUND',
      });
    return payment;
  };

module.exports = { create };
```

Ports are bound in one of two ways, never mixed:

1. Explicit: the entry in `exposes` has a factory map; the factory gets exactly
   those ports, plus `contract` and `transport` of the entry if its signature
   declares them. Signature and map must match (`SIGNATURE` error otherwise).
2. By name: a component without a factory map (private or `name: {}`) gets
   ports named in its signature, resolved in its unit's scope. Port `options`
   receives the configuration section with the component's name; ports
   `config`, `schemas`, `contracts`, `lib` receive whole namespaces.

A reference to a unit as a value gives the object of its exposed entries (each
guarded by its contract). Every component is created once per assembly;
construction cycles and references to components of another application are
errors (another application is reachable only through `consumes` with
`from`/`via`).

## 7. Contracts

- **operation** — file `contracts/handleWebhook.js`. Content:
  `{ input, output, errors }` referencing schemas.
- **interface** — file `contracts/Name.js`. Content:
  `{ operation: { input, output, errors }, ... }`.
- **versioned interface** — files `contracts/Payments/v1.js`, `v2.js`.
  Content: one interface per version file.

An interface operation may reference an operation of another contract instead
of repeating it: `getTransactionHistory: contracts.Payments.v1.getTransactionHistory`.
References: `contracts.Payments` (all versions), `contracts.Payments.v2`
(interface), `contracts.Payments.v2.createPayment` (operation).

Placement rule: a contract lies in the lowest unit that encloses all parties of
the interaction: provider (`exposes`), consumers (`consumes`, `from`) and
actors. A schema lies in the lowest unit that encloses all its users. Hence:
contracts between solutions (`PaymentGateway`, `CurrencyExchange`,
`handleWebhook`) are in `Enterprise`; client-server `Payments` is in
`PaymentSystem`; the gateway operator console is in the `PaymentGateway`
solution; storage records are in `persistence/schemas` and mock application
`schemas/`. Definitions are visible in their unit and all nested units, so
common contracts of clients and servers sit at their common level, whatever
level that is.

## 8. API versioning

- A versioned contract or schema is a folder of version files `vN.js`:
  `contracts/Payments/v1.js`, `schemas/Payment/v2.js`. A name is either a file
  or a version folder, never both. Versioned schemas are referenced with a
  version (`schemas.Payment.v2`, `'Payment.v2'` in Metaschema strings).
- An endpoint with a versioned contract serves all versions:
  `POST /api/Payments/v1/createPayment` and `/api/Payments/v2/createPayment`.
- A consumer pins a version in `from`: `PaymentProcessing.server.v2`; an
  unpinned versioned endpoint is an error.
- The implementation follows the latest version. For an older version the
  server checks input with that version's schema, calls the same operation and
  projects the output onto that version's schema, so additive changes need no
  code (v1 `Payment` has 6 fields, v2 has 12). A breaking change gets a new
  operation or a separate implementation.

## 9. Schemas

Schemas are a Metaschema-compatible subset:

- `'string'`, `'number'`, `'boolean'` — scalar, required.
- `'?string'` or `{ type, required: false }` — optional (`undefined` or
  `null`).
- `{ enum: [...] }` — one of values.
- `{ array: 'string' }`, `{ array: 'Item' }` — array of scalars or of a
  schema.
- `'Item'` — nested schema.
- `{ type, validate: lib.SchemaRules.f }` — field validator from `lib`.
- `validate: lib.SchemaRules.f` — structure validator.
- `Projection: { schema, fields, ui }` — subset of another schema plus UI
  hints.
- `identity: { primary: [...] }` — primary key metadata.
- `name: { unique: [...] }`, `{ index: [...] }` — unique and index metadata.

`check` is strict: unknown fields are errors. `project` keeps declared fields
only. Validators are pure functions in `lib/`, referenced, not inlined.

## 10. Configuration and environments

- Configuration exists only in applications: `config/<section>.json`. A client
  bundle physically contains only its application's sections.
- A section is named after the component that uses it: `config/database.json`
  is `options` of `persistence/database`. Explicit maps reference sections:
  `options: config.server`, `settlement: config.settlement`.
- Environments are folders in `config/`: `config/test/server.json`,
  `config/production/gateway.json`. The environment section is deep-merged over
  the base section (objects merge, other values replace). The environment is
  selected by `--env`, then `HIGHSCRIPT_ENV`, default `development`.
- Environment-specific values, including secrets, live in environment files;
  production files are provided at deployment.
- `config/application.json` is reserved for the platform: `{ "serve": { "host",
"port" } }` means "serve this application as a browser bundle".
- Relative paths in configuration (data directories) resolve from the working
  directory of the process.

## 11. Remote calls and transports

Protocol `http-json` (`highscript/http-server`, `highscript/http-client`):

- `POST <basePath>/<Interface>/<version>/<operation>` for versioned interfaces,
  `POST <basePath>/<Interface>/<operation>` otherwise; body is the input.
- Reply `{ result }` or `{ error: { code, message } }`. Errors of the request
  steps have their own status: 401 `UNAUTHORIZED`, 413 `PAYLOAD_TOO_LARGE`,
  400 `INVALID_INPUT` (not JSON or input check). An error of the
  implementation with a code declared in the operation's `errors` gives
  `errorStatus[code]` from config or 400; anything else gives 500 `INTERNAL`.
- `GET <basePath>` lists interfaces, versions and operations. Optional `token`
  (bearer), `cors`, `maxBodyBytes`.
- `server.mount({ contract, api, path, verify })` adds an interface or an
  operation contract to a server (operator console, webhook); `path` replaces
  `<basePath>/<Interface>`, `verify({ headers, body })` replaces bearer
  authorization. `server.route(method, path, handler)` adds a raw route.

A `via` adapter implements `call(path, input)`. For `{ from, via }` the
runtime builds a stub from the endpoint contract: one function per operation
(or a single function for an operation contract) that checks input, calls
`via.call('Payments/v2/createPayment', input)` and checks the output.
`createClient({ url, token, timeoutMs, sign, errorCode, logger })` is the
common `via`: `sign(body)` adds headers, `call('', input)` posts to `url`
itself, `errorCode` gives every failure of a remote that is not ours one
declared code (`GATEWAY_FAILURE`, `EXCHANGE_FAILURE`) so remote error codes
never pass for the caller's own; operations do not translate remote errors.
`transport: 'http-webhook'` is http-json at its own path with a signature
instead of a token: the gateway signs `${timestamp}.${body}` with HMAC-SHA256
(`highscript/signature`), the webhook mounts its operation contract with a
`verify` that checks the raw body.

## 12. Lifecycle

1. Plan: the compiler resolves the application and produces a serializable
   plan (components, ports, contracts, schemas, remote stubs, roots).
2. Assemble: starting from the application's `exposes`, the runtime creates
   reachable components in dependency order, each once. Unreachable private
   components are not created.
3. Start: `start()` of created results in creation order (server listens, UI
   renders). Registration happens in factories, accepting work in `start()`:
   the webhook attaches its route while the server is created, before it
   listens.
4. Close: `close()` in reverse order, idempotent; errors are collected into an
   `AggregateError`. A failure during assembly or start closes what was
   created.

## 13. Execution without a runtime field

The plan does not depend on the environment. `start` runs an application in
Node.js; `build` and `serve` wrap the same plan, component modules and runtime
into a browser bundle; `up` starts every implemented application below a unit
and serves those with `config/application.json` `serve`. The e2e test also
assembles `WebClient` in Node.js and runs the served bundle in a VM.

## 14. Code rules

- A component may `require` Node.js built-ins, npm packages, platform modules
  `highscript/<adapter>` and files inside its own folder (multi-file
  component). Requiring another project file is an error: use ports.
- Configuration is read through `options` or `config.*`, never from files; the
  logger is a port; there is no global state.
- Platform adapters: `http-server`, `http-client`, `json-store`, `logger`,
  `signature`. A component file that wraps an adapter is a few lines; another
  application wraps the same adapter in its own file.
- `lib/` is pure code without state and DI, referenced from DSL
  (`lib.SchemaRules.positiveMinor`) or received through port `lib`.
- Tests are `test/*.test.js` of the unit they test (`node:test`); other files
  in `test/` are helpers and scenarios. Unit tests call factories with fakes;
  integration tests use `highscript.plan(model, app, { env, config })`, where
  `config` overrides sections of that application (for example a temporary
  data directory), and `highscript.instantiate`.

## 15. Data access

A data layer has two parts: a driver (`persistence/database`) and a repository
(`persistence/Repository`) that knows only the driver interface
`collection(name, schema)`, `newId()`. The driver used now is
`highscript/json-store`: one JSON file per collection, constraints from record
schemas (primary, unique, strict check), serialized atomic writes (temp file
plus rename), `modify(key, fn)` as read-check-write in one step. Replacing the
driver with a database driver of the same shape does not change repositories.

## 16. Architecture check

`highscript check` (also `npm run check`) needs no arguments: it finds the
model from the current folder (the unit containing it, or the only unit folder
inside it). It validates folder structure and DSL, plans every application,
compares code with DSL and prints one diagnostic per line, then a summary:

```
warning DESIGN_ONLY       Enterprise.PaymentSystem.MobileClient: design-only application: ...
hint    SCAFFOLD          Enterprise: 5 file(s) can be generated from DSL, run highscript scaffold: ...
0 errors, 2 warnings, 1 hint (env development)
```

Errors mean the model cannot be planned or run, warnings are likely mistakes,
hints are improvements. The exit code is 1 when there are errors; `--json`
prints the list as `{ severity, code, where, message }`, `--env` selects the
configuration environment.

- error
  - `SYNTAX` — DSL file does not parse.
  - `LEVEL_FILE` — several level files in a folder.
  - `NESTING` — level cannot be inside the parent level.
  - `SECTION` — unknown or non-object DSL section (for example `runtime`).
  - `FOLDER` — folder is neither a unit nor a component.
  - `RESERVED_NAME`, `DUPLICATE` — reserved or repeated name, definition in
    two files.
  - `CODE_PLACE`, `CONFIG_PLACE` — code or `config/` above application.
  - `UNEXPECTED_FILE`, `VERSION_FILE`, `CONFIG_FILE` — bad file in
    `contracts/`, `schemas/`, `config/`.
  - `SHADOWING` — definition repeats a name of an enclosing unit.
  - `ACTOR` — actor consumes a name the unit does not expose.
  - `UNRESOLVED` — reference to an unknown name or definition.
  - `PRIVATE` — access to a non-exposed element of another unit.
  - `MISSING` — exposes entry has no implementation.
  - `SIGNATURE` — factory parameters differ from the port map.
  - `FACTORY` — no factory, or several factories without a map.
  - `CYCLE` — construction cycle.
  - `CROSS_APPLICATION` — direct reference to a component of another
    application.
  - `VERSION` — unknown or unpinned version.
  - `CONFIG` — missing configuration section.
  - `CONSUMES`, `ENDPOINT`, `REMOTE`, `CONTRACT`, `ENTRY`, `REFERENCE`,
    `AMBIGUOUS` — invalid consumes, endpoint, remote binding, contract, entry
    or reference.
  - `BOUNDARY` — code requires a file outside its component.
- warning
  - `DESIGN_ONLY` — application without code (errors in it become this
    warning).
  - `UNREACHABLE` — component that no application assembles.
  - `UNUSED_CONSUMES` — consumes entry nothing uses.
  - `UNUSED_CONFIG` — configuration section no component uses.
  - `ENV_SECTION` — environment section without a base section.
  - `UNUSED_DEFINITION` — contract, schema or lib module nobody uses.
  - `STUB` — scaffold template not implemented yet.
- hint
  - `PLACEMENT` — definition is used only inside a lower unit: move it there.
  - `UNUSED_VERSION` — older version that no consumer pins any more.
  - `UNUSED_EXPOSES` — exposed element of a service or component nobody uses.
  - `MISSING_TEST` — operation with a contract without a test that requires
    it.
  - `NO_CONTRACT` — service operation without a contract.
  - `SCAFFOLD` — files that `highscript scaffold` can generate.

Comparing code with DSL: the check loads every component module (signature,
factories, requires), scans component sources for `contracts.X`, `schemas.X`
and `lib.X` used through namespace ports and for unimplemented templates, and
scans `test/` folders for tests of operations. Usage warnings come from what
planning actually resolved, so they are reported only for applications that
plan without errors. Users of a definition are the units that reference it,
publish an endpoint with it or consume such an endpoint through `from`.

## 17. Scaffolding

`highscript scaffold` (also `npm run scaffold`) turns DSL files into project
structure. Like the check it needs no arguments. It reads
every reference in the DSL of the unit tree, in contracts and schemas and in
signatures of existing components, and creates what is missing:

- A PascalCase name, or any child of a logical level — unit folder with a
  level file of the next level.
- Members used from outside a new unit (`Orders.getOrder`) — entries in its
  `exposes`.
- A new unit passed to an interface entry (`api: Orders`) — the unit exposes
  the interface operations with their contracts.
- A component (exposes entry, port value, `via`, by-name port) — module
  template.
- `config.x`, or `options` of a component — `config/x.json`.
- A contract or a schema — nothing: a warning names the lowest unit enclosing
  its users.

Module templates depend on the role, so a scaffolded application assembles
and starts at once:

- Endpoint with `transport: 'http-json'` and port `api` — `createServer`
  wrapper, config section with host, port, path.
- `via` of an http-json endpoint — `createClient(options)`, config section
  with url.
- `logger`, `database` wired by name — `openLogger`, `openStore` wrappers
  with config sections.
- Entry with an operation contract — factory of an async function that throws
  "Not implemented".
- Interface contract, or members used (`gateway.verify`) — object with these
  methods, each throws "Not implemented".
- Any other component — factory of a function that throws "Not implemented".

Factory names come from factory maps (`open`, `create`), template signatures
list exactly the ports of the map, and an operation template has a comment
`name: Input -> Output`. New level files use the syntax of the parent level
file.

Existing files are never changed. New files can add references, so the
analysis repeats until nothing is missing. `--dry` lists the plan, `--json`
prints a machine-readable report, a lock file in the model root prevents
parallel runs. After writing, `highscript scaffold` runs the architecture
check, so one command shows what was created and what is left: missing
definitions, templates to implement (`STUB`), drift such as a factory
signature that no longer matches its map (`SIGNATURE`). There is no state
file: drift and orphans are found from the current files.

`highscript init <dir> --level solution --syntax md` creates a unit folder
with a starter level file. A project grows in the loop: write or change DSL,
scaffold, implement templates, check. In the example
`highscript scaffold Enterprise --dry` plans the five components of the
design-only `MobileClient` and `Terminal`.

## 18. Diagrams

Diagrams are another view of the same model, not a second notation.
`highscript diagram` (also `npm run diagram`) draws them from DSL files and
the code structure and, like the check, needs no arguments. It prints Markdown
with Mermaid diagrams; `--out file.md` writes it, `--out file.html` writes a
page that renders the diagrams in a browser, `--out file.mmd` writes the
landscape alone as Mermaid text.

One view fits every level, as the grammar does. The view of a unit shows:

- Inside its boundary — parts: child units with their level and components;
  parts that `exposes` does not name are private, `exposes` entries without
  code are design-only.
- Around it — actors of the unit and of enclosing units whose `consumes` reach
  inside.
- Outside — other parts of the model that the unit uses or that use it, each
  drawn at the level where it meets the unit (the child of their lowest common
  unit).
- Outside — requirements: `consumes` with `contract` and no provider in the
  model.

Arrows are references resolved by the scope rules, so a diagram shows what
the planner wires:

- `consumes` with `from` — `==>` call through a transport: contract, version
  and transport of the endpoint.
- `via` of a `consumes` entry — `-.->` from the adapter.
- Port maps in `exposes`, `consumes` references, by-name ports of factory
  signatures — `-->` use in process, labeled with the port when it differs
  from the target.
- `actors.X.consumes` — `-->` from the actor.

Arrows are projected on what the view shows: references inside a collapsed
part become arrows of the part, chains of `consumes` and re-exports are
followed to the part that provides them, a unit used as a whole
(`api: PaymentService`) is its boundary, arrows between the same nodes are
merged (a transport wins over a use, labels are joined). On the drawing, an
arrow that crosses the boundary of the view is attached to that boundary and
its label names the part inside. Contracts, schemas, `lib` and config are not
drawn: they are not parts.

`--depth n` expands parts n levels deep. The document starts with a landscape
of the unit down to applications (for an enterprise: solutions with their
applications), then has a view of every unit inside it.
`Enterprise/docs/architecture.md` of the example is generated this way, and a
test keeps it in sync with DSL.

## 19. Platform

```
highscript check                        check architecture (errors, warnings, hints)
highscript scaffold [--dry]             generate structure and templates, then check
highscript diagram [unit] [--out f]     draw diagrams: Markdown, HTML or Mermaid
highscript init <dir> --level l         new unit with a starter level file
highscript convert <path> --to s        rewrite DSL files in js, lisp or md
highscript print <file> --to s          show a DSL file in another syntax
highscript plan <application>           print the plan (JSON)
highscript start <application>          run in Node.js
highscript build <application> --out d  write index.html and app.js
highscript serve <application>          bundle and serve for browsers
highscript up [unit] [--scenario file]  run a landscape, optionally a scenario
```

Without a path, `check`, `scaffold`, `diagram`, `convert` and `up` work on the
model found from the current folder.

Node.js API (`platform/lib/index.js`): `load`, `check`, `diagram` (Mermaid of
one view), `diagrams` (document), `plan`, `assemble`,
`instantiate`, `start`, `config`, `connect` (stub for an endpoint such as
`PaymentGateway.operator.v1`), `bundle`, `serve`, `up`, `loadModule`,
`scaffold`, `init`, `convert`, `print`. `plan`, `assemble` and `start` accept
`{ env, config }`.

Engine layout: `parser` and `syntax` (js, lisp, md without evaluation),
`loader` (folder tree to units), `architecture` (check), `convert`, `scaffold`,
`diagram` (views and Mermaid), `planner` (scopes, references, plans, checks),
`runtime` and
`contracts`, `schema` (isomorphic), `modules` (guarded CommonJS loader),
`bundle`.

## 20. Example map

- Contracts shared by solutions — `Enterprise/contracts`,
  `Enterprise/schemas`.
- DSL in Lisp — `PaymentGateway/**/*.lisp`.
- DSL in Markdown — `CurrencyExchange/**/*.md`.
- Versioned API, v2 reusing v1 — `PaymentSystem/contracts/Payments`,
  `schemas/Payment`.
- Client pins a version — `WebClient/application.js` (v2), `MobileClient`
  (v1).
- `from` chains and re-export — `PaymentSystem/solution.js`,
  `PaymentGateway/solution.lisp`.
- Explicit maps and implicit contract — `PaymentProcessing/application.js`,
  `service.js`.
- By-name wiring and `options` — `gateway.js`, `persistence/database.js`,
  `charges.js`.
- Environments — `PaymentProcessing/config/{test,production}`.
- Application without service level — `PaymentGateway/GatewayMock`.
- Multi-file component — `WebClient/ui/`.
- Design-only applications — `MobileClient`, `Terminal`.
- End-to-end scenario — `Enterprise/test/scenario.js`.
- Diagrams generated from DSL — `Enterprise/docs/architecture.md`.

## 21. Limits

Not covered: authorization and permissions (actors are not roles), transactions
across collections (the JSON driver is not transactional), schema migrations,
contract compatibility checks between versions, parallel pipelines, workflows,
explicit start roots for background jobs without exposed entry points,
behavior diagrams (sequences of calls): diagrams show structure and
dependencies.
