/**
 * Jest setup file: make `request(app)` bind its ephemeral server to 127.0.0.1.
 *
 * Supertest wraps an Express app in `http.createServer(app).listen(0)`, which
 * binds the dual-stack wildcard `::`, and then sends the request to
 * `http://127.0.0.1:<port>`. On macOS the kernel will hand that wildcard
 * listener a port that another process already holds on 127.0.0.1 only (an
 * editor helper, a parallel test task), and a connection to 127.0.0.1:<port>
 * then reaches the more specific listener in that other process. The suite sees
 * a foreign response, usually Express's `404 Cannot GET`, for a route its own
 * app serves. Issue #1169 was this: one 404 under `nx run-many --parallel`.
 *
 * Binding 127.0.0.1 explicitly makes the kernel refuse a port already taken on
 * loopback, so the request can only reach this process's server.
 *
 * A listen with a host resolves it first, so the port is not known when
 * supertest builds the URL. `serverAddress` starts the listen and `end` waits
 * for it before supertest's own `end` sends the request (and, as before, closes
 * the server after the response). Both are typed in @types/supertest; a
 * supertest upgrade that stops using them fails supertestLoopback.test.ts
 * rather than going quiet.
 */
import type { CallbackHandler } from 'superagent';
import type { Server } from 'net';
import Test = require('supertest/lib/test');

const originalServerAddress = Test.prototype.serverAddress;
const originalEnd = Test.prototype.end;

/** Listens still resolving, keyed by server, so a TestAgent's second request waits too. */
const pendingListen = new WeakMap<Server, Promise<void>>();
/** URL resolutions each Test must finish before it sends. */
const pendingUrl = new WeakMap<Test, Promise<void>>();

Test.prototype.serverAddress = function serverAddress(
  this: Test & { _server?: Server },
  app,
  path,
) {
  const server = app as Server;
  if (server.address()) return originalServerAddress.call(this, app, path);

  let listening = pendingListen.get(server);
  if (!listening) {
    listening = new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    }).finally(() => pendingListen.delete(server));
    pendingListen.set(server, listening);
    this._server = server.listen(0, '127.0.0.1');
  }

  pendingUrl.set(
    this,
    listening.then(() => {
      this.url = originalServerAddress.call(this, app, path);
    }),
  );
  // Placeholder until the listen resolves; `end` replaces it before sending.
  return `http://127.0.0.1${path}`;
};

Test.prototype.end = function end(this: Test, fn?: CallbackHandler) {
  const ready = pendingUrl.get(this);
  if (!ready) return originalEnd.call(this, fn);

  pendingUrl.delete(this);
  ready.then(
    // A block body: returning the Test (a thenable) would make the promise
    // adopt it and call `end` a second time.
    () => {
      originalEnd.call(this, fn);
    },
    (error: Error) => fn?.(error, undefined as never),
  );
  return this;
};
