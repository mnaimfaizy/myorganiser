//@ts-check

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * The workspace version, for the Report Context on a Feedback Report.
 *
 * Read as a file rather than `require`d: the workspace package.json is outside
 * this project, and importing across that line by relative path is what
 * `@nx/enforce-module-boundaries` refuses. Reading it is also how the
 * assertion gates and `check-openapi-artifacts.ts` take the same value.
 */
const workspaceVersion = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
).version;

/**
 * A plain Next.js config: the Nx Next.js plugin infers `build`, `dev`, and
 * `start` from this file, so nothing here depends on Nx (ADR 0083).
 *
 * @type {import('next').NextConfig}
 **/
const nextConfig = {
  // cPanel-friendly Node deployment, on every environment (ADR 0128).
  // Produces .next/standalone, which `yarn package:web` turns into
  // a bundle that runs with `node server.js`.
  output: 'standalone',
  // The running process puts its build id in the HTML it renders. Staging's
  // deploy sets WEB_BUILD_ID to the commit, so a probe can tell which build
  // is answering without a shell on the host (issue #1138). Unset, `null`
  // makes Next.js generate its own id, which is every other build.
  generateBuildId: async () => process.env.WEB_BUILD_ID || null,
  // The Report Context on a Feedback Report names the app version that sent it
  // (PRD #1206). Taken from the workspace package.json at build time, so there
  // is no second copy of the version and no environment variable to set.
  env: {
    NEXT_PUBLIC_APP_VERSION: workspaceVersion,
  },
  poweredByHeader: false,
  // `next dev` refuses its dev resources (HMR) to any hostname but localhost
  // and the one it started on. Opening the dev server from a phone on the LAN
  // needs that machine's address listed. It differs per developer and per
  // network, so it comes from the environment, comma-separated hostnames with
  // no scheme or port (e.g. `192.168.1.7`). Unset means Next.js's default.
  // Ignored by `next build` and `next start`.
  allowedDevOrigins: (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  async headers() {
    return [
      {
        // The service worker (ADR 0127). Never cached, so a deployment's
        // worker is the one a browser runs on its next check, and confined to
        // same-origin scripts and requests. These are set here, not in a
        // request-interception file (ADR 0019). A host that serves public/
        // from disk never reaches this rule. There the last two headers come
        // from a block in the host's own .htaccess, appended once from
        // deploy/sw-headers.htaccess: keep the two in step. Never add a
        // public/.htaccess; it would overwrite the host's.
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        // The per-channel grid was replaced by the channel directory on
        // /dashboard/youtube, which is the locked long-form home (PRD #264,
        // Variant C / issue #250). Digest emails already sitting in Users'
        // inboxes point at the old path, so it is redirected, not removed.
        source: '/dashboard/youtube/channel/:channelId',
        destination: '/dashboard/youtube?channel=:channelId',
        permanent: true,
      },
      {
        // The standalone export/import route and the account-nested vault
        // settings route were consolidated into /dashboard/vault (PRD #478,
        // issue #482). Unlike the YouTube redirect above, a repo-wide sweep
        // found no email, notification, or backend reference to either old
        // path — this pair is bookmark insurance, not a hard requirement,
        // and is safe to drop once that risk feels stale.
        source: '/dashboard/vault-export',
        destination: '/dashboard/vault',
        permanent: true,
      },
      {
        source: '/dashboard/account/vault',
        destination: '/dashboard/vault',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
