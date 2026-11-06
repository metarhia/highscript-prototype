'use strict';

// HTTP adapter for exposed endpoints with transport 'http-json'.
// Routes: POST <basePath>/<Interface>/<version>/<operation> for versioned
// interfaces, POST <basePath>/<Interface>/<operation> otherwise.
// Body is the operation input; reply is { result } or { error }.
// GET <basePath> lists interfaces, versions and operations.

const http = require('node:http');
const { once } = require('node:events');
const { checkInput, checkOutput, isDeclared } = require('../lib/contracts.js');
const { openLogger } = require('./logger.js');

const DEFAULTS = {
  host: '127.0.0.1',
  port: 0,
  basePath: '/api',
  maxBodyBytes: 65536,
  cors: null,
  token: null,
  errorStatus: {},
};

// Error that already knows its HTTP status and is safe to show the caller.
const fault = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

const receive = async (request, limit) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw fault(413, 'PAYLOAD_TOO_LARGE', 'Body is too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const interfaces = (contract) => {
  if (contract.kind === 'versioned') return Object.values(contract.versions);
  return [contract];
};

const createServer = ({
  options,
  logger = openLogger({ name: 'http', level: 'warn' }),
  contract,
  api,
}) => {
  const settings = { ...DEFAULTS, ...options };
  const routes = new Map();
  const listing = {};

  const headers = (request) => {
    const result = {};
    const origin = request.headers.origin;
    const { cors } = settings;
    if (cors && origin && (cors === '*' || [].concat(cors).includes(origin))) {
      result['access-control-allow-origin'] = cors === '*' ? '*' : origin;
      result['access-control-allow-headers'] = 'content-type, authorization';
      result['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    }
    return result;
  };

  const send = (request, response, status, body, extra = {}) => {
    if (response.headersSent) return;
    const isBuffer = Buffer.isBuffer(body) || typeof body === 'string';
    const payload = isBuffer ? body : JSON.stringify(body);
    const type = isBuffer ? 'text/plain; charset=utf-8' : 'application/json';
    response.writeHead(status, {
      'content-type': type,
      ...headers(request),
      ...extra,
    });
    response.end(payload);
  };

  // Default authorization of RPC calls: bearer token when configured.
  const bearer = ({ headers: { authorization } }) =>
    !settings.token || authorization === `Bearer ${settings.token}`;

  // Request steps fail with the caller's status (401, 413, 400); the
  // implementation fails with a declared code or becomes 500.
  const rpc =
    (operation, implementation, authorize) => async (request, response) => {
      const body = await receive(request, settings.maxBodyBytes);
      const text = body.toString('utf8');
      if (!authorize({ headers: request.headers, body: text })) {
        throw fault(401, 'UNAUTHORIZED', 'Not authorized');
      }
      let input;
      try {
        input = text ? JSON.parse(text) : {};
        checkInput(operation, input);
      } catch (error) {
        throw fault(
          400,
          'INVALID_INPUT',
          error.code ? error.message : 'Body is not JSON',
        );
      }
      let output;
      try {
        output = checkOutput(operation, await implementation(input));
      } catch (error) {
        if (!isDeclared(operation, error)) throw error;
        const status = settings.errorStatus[error.code] ?? 400;
        throw fault(status, error.code, error.message);
      }
      send(request, response, 200, { result: output });
    };

  // Mounts an interface (all versions) or an operation contract.
  // path replaces <basePath>/<Interface>; verify replaces bearer auth.
  const mount = ({ contract: mounted, api: target, path, verify = bearer }) => {
    const prefix = path || `${settings.basePath}/${mounted.name}`;
    const versions = {};
    listing[mounted.name] = versions;
    for (const iface of interfaces(mounted)) {
      if (iface.kind === 'operation') {
        routes.set(`POST ${prefix}`, rpc(iface, target, verify));
        versions.operation = prefix;
        continue;
      }
      const base = iface.version ? `${prefix}/${iface.version}` : prefix;
      versions[iface.version || 'current'] = Object.keys(iface.operations);
      for (const [name, operation] of Object.entries(iface.operations)) {
        const fn = target?.[name];
        if (typeof fn !== 'function') {
          throw new Error(`${mounted.name}: api has no ${name}`);
        }
        const route = rpc(operation, fn.bind(target), verify);
        routes.set(`POST ${base}/${name}`, route);
      }
    }
  };

  // Raw route: handler({ headers, body, url }) -> { status, body, headers }.
  const route = (method, path, handler) => {
    routes.set(`${method} ${path}`, async (request, response) => {
      const body = await receive(request, settings.maxBodyBytes);
      const reply = await handler({
        headers: request.headers,
        body,
        url: request.url,
      });
      send(
        request,
        response,
        reply.status ?? 200,
        reply.body ?? '',
        reply.headers,
      );
    });
  };

  const server = http.createServer((request, response) => {
    const path = request.url.split('?')[0];
    if (request.method === 'OPTIONS') {
      return void send(request, response, 204, '');
    }
    if (request.method === 'GET' && path === settings.basePath) {
      return void send(request, response, 200, { interfaces: listing });
    }
    const handler = routes.get(`${request.method} ${path}`);
    if (!handler) {
      const error = {
        code: 'NOT_FOUND',
        message: `No route ${request.method} ${path}`,
      };
      return void send(request, response, 404, { error });
    }
    handler(request, response).catch((error) => {
      let { status, code, message } = error;
      if (!status) {
        logger.error(`${request.method} ${path}: ${error.stack || message}`);
        [status, code, message] = [500, 'INTERNAL', 'Internal error'];
      }
      send(request, response, status, { error: { code, message } });
    });
  });

  if (contract) mount({ contract, api });

  let address = null;
  const start = async () => {
    server.listen(settings.port, settings.host);
    await once(server, 'listening');
    const { port } = server.address();
    address = `http://${settings.host}:${port}`;
    logger.info(`listening on ${address}${settings.basePath}`);
  };

  const close = async () => {
    if (!server.listening) return;
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  };

  return {
    mount,
    route,
    start,
    close,
    get address() {
      return address;
    },
  };
};

module.exports = { createServer };
