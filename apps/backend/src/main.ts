import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import 'dotenv/config';
import express, { Request as ExRequest, Response as ExResponse } from 'express';
import helmet from 'helmet';
import * as path from 'path';
import swaggerUi from 'swagger-ui-express';
import { createCorsOptions } from './config/http';
import { validateGoogleRedirectUriOnBoot } from './config/youtubeRedirectUri';
import { createTsoaErrorHandler } from './helpers/httpErrorHandler';
import { maybeCreateGlobalApiRateLimiterFromEnv } from './middleware/globalRateLimit';
import { createVersionFloorMiddleware } from './middleware/versionFloor';
import { createYouTubeAvailabilityGate } from './middleware/youtubeAvailabilityGate';
import { vaultRateLimiter } from './middleware/vaultRateLimit';
import { bootstrapPlatformAdminFromEnv } from './bootstrap/platformAdminBootstrap';
import { deleteSupersededTodosBlobsOnBoot } from './bootstrap/deleteSupersededTodosBlobs';
import {
  logMissingColumnHint,
  warnPendingMigrationsOnBoot,
} from './bootstrap/warnPendingMigrations';
import { RegisterRoutes } from './routes/routes';
import usersRouter from './routes/user';
import passport from './utils/passport';

// ADR 0091: refuse to start rather than serve a misconfigured YouTube OAuth
// redirect in production. No-op outside production or with the switch off.
validateGoogleRedirectUriOnBoot();

function normalizeRouterPrefix(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '');
  return withoutTrailingSlash === '/' ? '' : withoutTrailingSlash;
}

function joinPath(a: string, b: string): string {
  const left = normalizeRouterPrefix(a);
  const right = normalizeRouterPrefix(b);
  if (!left) return right;
  if (!right) return left;
  return `${left}${right}`;
}

const routerPrefix =
  normalizeRouterPrefix(process.env.ROUTER_PREFIX) || '/api/v1';

// cPanel Passenger can mount the app under a base URI.
// When configured, requests arrive with that base prefix.
const passengerBaseUri = normalizeRouterPrefix(process.env.PASSENGER_BASE_URI);
const app = express();

const isProd = process.env.NODE_ENV === 'production';

function parseTrustProxy(value: string | undefined): boolean | number {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return isProd ? 1 : false;
  if (raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === 'false' || raw === 'no' || raw === 'off') return false;
  const asInt = Number.parseInt(raw, 10);
  return Number.isFinite(asInt) ? asInt : false;
}

// Avoid leaking stack traces and enable correct proto/ip detection behind reverse proxies.
app.disable('x-powered-by');
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// Production hardening.
app.use(
  helmet({
    // Swagger UI relies on inline scripts/styles; keep CSP off globally for now.
    contentSecurityPolicy: false,
  }),
);
app.use(compression());

// Middleware to parse JSON bodies
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '2mb' }));

// Serve Swagger UI.
function mountSwagger(mountPath: string) {
  app.use(
    mountPath,
    swaggerUi.serve,
    async (req: ExRequest, res: ExResponse) => {
      const swaggerDocument = await import('./swagger/swagger.json').then(
        (module) => module.default,
      );

      // tsoa spec config is generated with a localhost server; override it at runtime
      // so Swagger "Try it out" targets the actual deployed host.
      const forwardedProto = (
        req.headers['x-forwarded-proto'] as string | undefined
      )
        ?.split(',')[0]
        ?.trim();
      const proto = forwardedProto || req.protocol;
      const host = req.get('host');
      const origin = host ? `${proto}://${host}` : '';

      const canonicalApiBase = origin
        ? `${origin}${joinPath(passengerBaseUri, routerPrefix)}`
        : '';
      const doc = JSON.parse(JSON.stringify(swaggerDocument)) as any;
      const servers: Array<{ url: string; description?: string }> = [];
      if (canonicalApiBase) {
        servers.push({ url: canonicalApiBase, description: 'API (prefixed)' });
      }
      if (servers.length > 0) {
        doc.servers = servers;
      }

      res.send(swaggerUi.generateHTML(doc));
    },
  );
}

// Swagger UI is exposed at common locations.
// Keep it accessible regardless of router prefix and Passenger base URI.
const swaggerMounts = new Set<string>();
swaggerMounts.add('/docs');
swaggerMounts.add(`${routerPrefix}/docs`);
if (passengerBaseUri) {
  swaggerMounts.add(joinPath(passengerBaseUri, '/docs'));
  swaggerMounts.add(joinPath(passengerBaseUri, `${routerPrefix}/docs`));
}
for (const mountPath of swaggerMounts) {
  mountSwagger(mountPath);
}

// Enable CORS
app.use(cors(createCorsOptions()));

// Enable cookie parser
app.use(cookieParser());

// Serve the static files
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Initialize passport
app.use(passport.initialize());

// Define the API routes under a single prefix.
const api = express.Router();

// ADR 0114: refuse Mobile Apps below the Version Floor first, before the rate
// limiter, the routers, and authentication, so a stale client is told to update.
api.use(createVersionFloorMiddleware());

// Optional global API rate limiting (recommended for production).
// Note: default store is in-memory; for multi-instance deployments use a shared store.
const globalApiRateLimiter = maybeCreateGlobalApiRateLimiterFromEnv();
if (globalApiRateLimiter) api.use(globalApiRateLimiter);

api.use('/user', usersRouter);

// Apply additional protections for blind-storage endpoints.
api.use('/vault', vaultRateLimiter);

// ADR 0091: when the switch is off, every YouTube route 404s except the
// cron endpoints (which succeed and do nothing) and the availability report.
api.use('/youtube', createYouTubeAvailabilityGate());

// Register tsoa routes
RegisterRoutes(api);

// Mount API routes in a tolerant way to avoid base-path/prefix mismatches
// across local dev, reverse proxies, and cPanel Passenger.
const apiMounts = new Set<string>();
apiMounts.add(routerPrefix || '/');
if (passengerBaseUri) {
  apiMounts.add(joinPath(passengerBaseUri, routerPrefix));
}
for (const mountPath of apiMounts) {
  app.use(mountPath, api);
}

// Error handler for 404 routes
app.use(function notFoundHandler(_req, res: ExResponse) {
  res.status(404).send({
    message: 'Not Found',
  });
});

app.use(
  createTsoaErrorHandler({
    onValidateError: (err, req) => {
      console.warn(`Caught Validation Error for ${req.path}:`, err.fields);
    },
    onUnhandledError: (err, req) => {
      logMissingColumnHint(err, isProd);
      if (isProd) {
        console.error(
          `Unhandled error on ${req.method} ${req.path}:`,
          err.message,
        );
      } else {
        console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
      }
    },
  }),
);

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Listening at: http://localhost:${port}/`);
  void bootstrapPlatformAdminFromEnv();
  void deleteSupersededTodosBlobsOnBoot();
  void warnPendingMigrationsOnBoot();
});
server.on('error', console.error);

function shutdown(
  signal: string,
  opts: { exitCode: number; forceExit: boolean },
) {
  console.log(`Received ${signal}; shutting down...`);
  server.close(() => {
    process.exitCode = opts.exitCode;
    if (opts.forceExit) {
      process.exit(opts.exitCode);
    }
  });
  if (opts.forceExit) {
    // Force shutdown if connections hang.
    setTimeout(() => process.exit(Math.max(opts.exitCode, 1)), 10_000).unref();
  }
}

process.on('SIGTERM', () =>
  shutdown('SIGTERM', { exitCode: 0, forceExit: true }),
);
process.on('SIGINT', () =>
  shutdown('SIGINT', { exitCode: 0, forceExit: true }),
);

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  shutdown('unhandledRejection', { exitCode: 1, forceExit: false });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException', { exitCode: 1, forceExit: false });
});
