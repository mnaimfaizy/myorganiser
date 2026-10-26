/**
 * Pure decision logic for CI-owned Host Apply (ADR 0056, issue #566).
 *
 * A failed migration and then a stale Prisma client both shipped to Production
 * because "go live" stayed on interactive SSH, run only when someone remembered.
 * This module is the part of that sequence CI can own without ever holding
 * `DATABASE_URL` itself: it takes the resolved values of the named
 * secrets (`HOST_APPLY_SECRET_NAMES`) from the caller — the GitHub Actions
 * workflow built in #567 — and produces the on-host command sequence, refuses
 * unsafe inputs, and can grade a captured log for a leaked credential.
 * `DATABASE_URL` is the one value this module never takes as input and never
 * emits: the generated script loads it on the host, at apply time, from the
 * selector store. It never opens a real SSH connection — verifying that
 * belongs to a live host, not a unit test.
 *
 * Run the tests with: yarn host-apply:test
 */

/** Refusal raised by a guard in this module. Never carries a secret value. */
export class HostApplyRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostApplyRefusal';
  }
}

/**
 * The only names Host Apply ever reads as secrets (ADR 0056, PRD #565 decision
 * "Implementation Decisions"). `DATABASE_URL` is deliberately absent — it is
 * loaded on the host from the selector store, never a GitHub secret. The public
 * secret-name table in `docs/deployment/CI_CD_AND_RELEASE_PROCESS.md` lists the
 * same names; keep both in sync by hand, there is no shared source yet.
 *
 * `COUNTERPART_APP_ROOT` and `SSH_KNOWN_HOSTS` extend PRD #565's original list
 * of eight. Both close a hole that list left open: without a counterpart pin
 * `assertAppRootGuard` can only refuse an unset `APP_ROOT`, so PRD user stories
 * 20 and 21 (Staging refusing Production's root, and the reverse) had no live
 * path; without pinned host keys the SSH step trusted whatever key answered on
 * a runner that has no memory of the last connection.
 */
export const HOST_APPLY_SECRET_NAMES: readonly string[] = Object.freeze([
  'SSH_HOST',
  'SSH_PORT',
  'SSH_USER',
  'SSH_PRIVATE_KEY',
  'SSH_KNOWN_HOSTS',
  'APP_ROOT',
  'COUNTERPART_APP_ROOT',
  'NODEVENV_ACTIVATE',
  'SELECTOR_APP_KEY',
  'API_ORIGIN',
]);

/** The on-host sequence, in the order the PRD pins as the contract. */
export const HOST_APPLY_STEP_ORDER: readonly string[] = Object.freeze([
  'activate-nodevenv',
  'enter-app-root',
  'load-database-url',
  'npm-ci',
  'prisma-migrate-deploy',
  'prisma-generate',
  'restart',
  'migrate-status',
]);

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HostApplyRefusal(
      `${name} is required and must be a non-empty string`,
    );
  }
  return value;
}

/** Single-quotes a value for POSIX shell, escaping embedded single quotes. */
function shQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds the shell fragment that loads `DATABASE_URL` on the host for exactly
 * one app identity (`selectorAppKey`) from the Node.js selector store, and
 * refuses without printing the value if the identity or the key is missing.
 *
 * The lookup reads the identity's own entry by key (`data[key]`) — it never
 * iterates the store, so it cannot walk a sibling app even if the generated
 * script were somehow inspected. The URL only ever exists inside a `$(...)`
 * command substitution assigned straight to a shell variable; nothing in this
 * fragment echoes, prints, or logs it.
 *
 * The store location and shape (`SELECTOR_STORE_PATH`, `SELECTOR_ENV_FIELD`)
 * were confirmed against the real host during #569, replacing this engine's
 * original guess of `~/.cpanel/nodejsapps.json` with variables under
 * `envvars`. Both were wrong: on this CloudLinux account `~/.cpanel` holds no
 * Node config at all, the Selector keeps its store elsewhere, and the field is
 * spelled with an underscore. A wrong pin fails closed (exit 4, refused)
 * rather than misreading another app, so the cost was a red preflight rather
 * than a bad migration — which is what the preflight is for.
 */
export function buildSelectorLoadStep(
  selectorAppKey: string | undefined,
): string {
  requireNonEmptyString(selectorAppKey, 'SELECTOR_APP_KEY');

  const lookup = [
    'const fs = require("fs");',
    'const path = require("path");',
    `const key = ${JSON.stringify(selectorAppKey)};`,
    `const file = path.join(process.env.HOME || "", ${SELECTOR_STORE_PATH.split(
      '/',
    )
      .map((segment) => JSON.stringify(segment))
      .join(', ')});`,
    `const field = ${JSON.stringify(SELECTOR_ENV_FIELD)};`,
    'let data;',
    'try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(4); }',
    'const hasKey = data != null && Object.prototype.hasOwnProperty.call(data, key);',
    'const entry = hasKey ? data[key] : undefined;',
    'const url = entry && entry[field] ? entry[field].DATABASE_URL : undefined;',
    'if (!url) process.exit(4);',
    'process.stdout.write(url);',
  ].join(' ');

  return [
    `DATABASE_URL="$(node -e ${shQuote(lookup)})" || { echo "host-apply: refused - selector has no DATABASE_URL for the configured app identity" >&2; exit 1; }`,
    '[ -n "$DATABASE_URL" ] || { echo "host-apply: refused - selector returned an empty DATABASE_URL" >&2; exit 1; }',
    'export DATABASE_URL',
  ].join('\n');
}

/**
 * Where the cPanel Node.js Selector might keep an app's configured environment
 * variables, and under which field. `buildSelectorLoadStep` deliberately pins
 * the first of each rather than walking these at apply time: a walk would need
 * iteration the no-enumeration rule bans, and buys nothing once the real
 * location is known. Discovery happens once, before the first apply, through
 * `buildSelectorProbeScript` — and a wrong pin fails closed rather than
 * silently reading the wrong app.
 */
/**
 * The pinned pair `buildSelectorLoadStep` reads at apply time, confirmed
 * against the host in #569. `SELECTOR_STORE_CANDIDATES` leads with it and the
 * preflight refuses if discovery finds the value anywhere else, so these two
 * constants are the only place the location is written down.
 */
export const SELECTOR_STORE_PATH = '.cl.selector/node-selector.json';
export const SELECTOR_ENV_FIELD = 'env_vars';

export const SELECTOR_STORE_CANDIDATES = Object.freeze([
  SELECTOR_STORE_PATH,
  '.cpanel/nodejsapps.json',
  '.cpanel/nodejs.json',
]);

export const SELECTOR_ENV_FIELDS = Object.freeze([
  SELECTOR_ENV_FIELD,
  'envvars',
  'environment',
  'env',
]);

/**
 * A read-only probe that reports where the selector store actually is and
 * which field holds the pinned app's `DATABASE_URL`, so the operator checklist
 * for the first live apply (#569) can confirm this engine's assumption instead
 * of discovering it in a red CI run.
 *
 * Unlike `buildSelectorLoadStep` this may iterate — over candidate *file
 * paths* and candidate *field names*, never over the store's app entries. It
 * looks up the pinned key with `hasOwnProperty` exactly as the loader does, so
 * it can neither see nor report a sibling app. It emits booleans and field
 * names only: no environment value, and no `DATABASE_URL`, ever reaches the
 * report.
 *
 * Never part of an apply — nothing in `HOST_APPLY_STEP_ORDER` calls it.
 */
export function buildSelectorProbeScript(
  selectorAppKey: string | undefined,
): string {
  requireNonEmptyString(selectorAppKey, 'SELECTOR_APP_KEY');

  const probe = [
    'const fs = require("fs");',
    'const path = require("path");',
    `const key = ${JSON.stringify(selectorAppKey)};`,
    `const candidates = ${JSON.stringify(SELECTOR_STORE_CANDIDATES)};`,
    `const fields = ${JSON.stringify(SELECTOR_ENV_FIELDS)};`,
    'const home = process.env.HOME || "";',
    'const report = candidates.map((rel) => {',
    '  const file = path.join(home, rel);',
    '  const row = { path: rel, exists: false, parsed: false, hasPinnedKey: false, envField: null, hasDatabaseUrl: false };',
    '  if (!fs.existsSync(file)) return row;',
    '  row.exists = true;',
    '  let data;',
    '  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return row; }',
    '  row.parsed = true;',
    '  if (data == null || !Object.prototype.hasOwnProperty.call(data, key)) return row;',
    '  row.hasPinnedKey = true;',
    '  const entry = data[key];',
    '  const match = fields.find((f) => entry && entry[f] && typeof entry[f].DATABASE_URL === "string" && entry[f].DATABASE_URL.length > 0);',
    '  if (match) { row.envField = match; row.hasDatabaseUrl = true; }',
    '  return row;',
    '});',
    'process.stdout.write(JSON.stringify({ selectorProbe: report }));',
  ].join(' ');

  return `node -e ${shQuote(probe)}`;
}

/**
 * Puts `node` and `npm` on PATH by sourcing the environment's Node virtualenv.
 *
 * `set -u` is suspended across the vendor script and nothing else. CloudLinux's
 * nodevenv activate reads `CL_VIRTUAL_ENV` unguarded, so `set -u` aborts on its
 * line 78 — before `node` exists — and every apply would have died there. We do
 * not own that script and cannot fix it; `-e` and `pipefail` stay on
 * throughout, and `-u` is restored immediately after, so every command this
 * module writes itself is still covered.
 *
 * Shared with the preflight so a rehearsal activates exactly the way an apply
 * does. Found the hard way: the preflight originally ran its own remote `node`
 * without activating at all, and reported `node: command not found` for checks
 * that had nothing to do with node being absent.
 */
export function buildActivateCommand(
  nodevenvActivate: string | undefined,
): string {
  requireNonEmptyString(nodevenvActivate, 'NODEVENV_ACTIVATE');
  return ['set +u', `source ${shQuote(nodevenvActivate)}`, 'set -u'].join('\n');
}

/**
 * Builds the ordered on-host steps from secret values the caller already
 * resolved (from GitHub Environment secrets — this module never fetches
 * them). Throws `HostApplyRefusal` if any required secret is missing.
 */
export interface HostApplyStep {
  id: string;
  command: string;
}

export function buildHostApplySteps({
  nodevenvActivate,
  appRoot,
  selectorAppKey,
}: {
  nodevenvActivate?: string;
  appRoot?: string;
  selectorAppKey?: string;
}): HostApplyStep[] {
  requireNonEmptyString(nodevenvActivate, 'NODEVENV_ACTIVATE');
  requireNonEmptyString(appRoot, 'APP_ROOT');
  requireNonEmptyString(selectorAppKey, 'SELECTOR_APP_KEY');

  return [
    {
      id: 'activate-nodevenv',
      command: buildActivateCommand(nodevenvActivate),
    },
    { id: 'enter-app-root', command: `cd ${shQuote(appRoot)}` },
    { id: 'load-database-url', command: buildSelectorLoadStep(selectorAppKey) },
    { id: 'npm-ci', command: 'npm ci --omit=dev' },
    { id: 'prisma-migrate-deploy', command: 'npm run prisma:migrate:deploy' },
    { id: 'prisma-generate', command: 'npm run prisma:generate' },
    // `mkdir -p` first: a missing `tmp/` would abort the script here, after
    // migrate and generate have already run and before Passenger is told to
    // reload — the stale-client state this whole sequence exists to prevent.
    { id: 'restart', command: 'mkdir -p tmp && touch tmp/restart.txt' },
    { id: 'migrate-status', command: 'npm run prisma:migrate:status' },
  ];
}

/**
 * Renders steps into one POSIX script for a single SSH invocation.
 * `set -euo pipefail` is what makes this fail closed (ADR 0056): the first
 * failing step (a pending migration, a missing script) aborts everything
 * after it, so a bad `prisma migrate deploy` can never reach `restart`.
 */
export function renderHostApplyScript(steps: HostApplyStep[]): string {
  return ['set -euo pipefail', ...steps.map((step) => step.command)].join('\n');
}

/** Convenience wrapper: secrets in, `{ steps, script }` out. */
export function buildHostApplyScript(secrets: {
  nodevenvActivate?: string;
  appRoot?: string;
  selectorAppKey?: string;
}): { steps: HostApplyStep[]; script: string } {
  const steps = buildHostApplySteps(secrets);
  return { steps, script: renderHostApplyScript(steps) };
}

/**
 * Refuses an `APP_ROOT` that is unset, or that collides with the other
 * environment's pinned root (ADR 0056: a shared hosting account means an SSH
 * principal that can Host Apply Staging can reach Production's tree).
 *
 * `counterpartAppRoot` is the *other* environment's pin, supplied as that
 * environment's own `COUNTERPART_APP_ROOT` secret. It is required, not
 * optional: an absent pin would silently reduce this guard to the unset check,
 * which is exactly the failure PRD user stories 20 and 21 exist to prevent —
 * a `main` push migrating Production because Staging's `APP_ROOT` was typed
 * wrong. A missing counterpart therefore refuses the apply rather than running
 * an unguarded one.
 */
export function assertAppRootGuard({
  environment,
  appRoot,
  counterpartAppRoot,
}: {
  environment: string;
  appRoot?: string;
  counterpartAppRoot?: string;
}): string {
  if (environment !== 'staging' && environment !== 'production') {
    throw new HostApplyRefusal(
      `unknown Host Apply environment: ${JSON.stringify(environment)}`,
    );
  }

  appRoot = requireNonEmptyString(appRoot, 'APP_ROOT');
  counterpartAppRoot = requireNonEmptyString(
    counterpartAppRoot,
    'COUNTERPART_APP_ROOT',
  );

  if (appRoot === counterpartAppRoot) {
    const other = environment === 'staging' ? 'Production' : 'Staging';
    throw new HostApplyRefusal(
      `APP_ROOT for ${environment} equals the ${other} pin - refusing to avoid crossing app roots`,
    );
  }

  return appRoot;
}

/**
 * Patterns a captured Host Apply log must never match. Issue #566 names two
 * shapes explicitly: a full connection string, and a bare `DATABASE_URL=`
 * assignment (the second catches an accidental `env | grep` even when no
 * connection string is present).
 */
const LOG_LEAK_RULES = Object.freeze([
  { id: 'database-url-assignment', pattern: /DATABASE_URL\s*=/ },
  {
    id: 'connection-string',
    pattern: /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?):\/\/\S+/i,
  },
] as const);

export interface HostApplyLogLeak {
  line: number;
  rule: string;
  text: string;
}

/** Every redaction violation in `logText`, one entry per matching line. */
export function findHostApplyLogLeaks(logText: string): HostApplyLogLeak[] {
  const lines = String(logText).split('\n');
  const findings: HostApplyLogLeak[] = [];

  lines.forEach((line, index) => {
    for (const rule of LOG_LEAK_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ line: index + 1, rule: rule.id, text: line });
      }
    }
  });

  return findings;
}

/** Throws `HostApplyRefusal` if `logText` leaks a secret; otherwise returns void. */
export function assertHostApplyLogClean(logText: string): void {
  const findings = findHostApplyLogLeaks(logText);
  if (findings.length === 0) return;

  throw new HostApplyRefusal(
    `host apply log contains ${findings.length} redaction violation(s): ` +
      findings.map((f) => `line ${f.line} (${f.rule})`).join(', '),
  );
}

/**
 * Grades the two HTTP probes issue #567 requires after a Host Apply run
 * (ADR 0056 verify step): `GET {API_ORIGIN}/docs` must be 2xx (Passenger came
 * back), and a cron POST carrying a deliberately wrong secret must be exactly
 * `401` — never a `500` (a stale Prisma client, v0.4.0's second failure) and
 * never an HTML `403` (a host-level challenge page standing in for the API's
 * own auth rejection, which would prove nothing about the API itself).
 * Pure grading only: the caller performs the actual requests and passes the
 * two resulting status codes, which is what lets this run in a test without
 * a live host.
 */
export function assertHostApplyProbesHealthy({
  docsStatus,
  cronStatus,
}: {
  docsStatus: number;
  cronStatus: number;
}): void {
  const failures: string[] = [];

  if (
    !(Number.isInteger(docsStatus) && docsStatus >= 200 && docsStatus < 300)
  ) {
    failures.push(
      `GET {API_ORIGIN}/docs returned ${docsStatus}, expected 2xx` +
        (docsStatus >= 300 && docsStatus < 400
          ? ' - a redirect, so the probe did not follow one: /docs answers 301 to /docs/'
          : ''),
    );
  }

  if (cronStatus !== 401) {
    failures.push(
      `wrong-secret cron POST returned ${cronStatus}, expected 401` +
        (cronStatus === 403
          ? ' - 403 is the host answering, not the API: a POST with no Content-Type never reaches Node'
          : ''),
    );
  }

  // Both are reported together. Throwing on the first meant an operator fixed
  // /docs, spent another apply, and only then learned the cron probe was wrong
  // too - which is what the first live run cost (#569).
  if (failures.length > 0) {
    throw new HostApplyRefusal(failures.join('\n'));
  }
}

/**
 * The `npm run` scripts the deploy bundle must keep exposing so this engine's
 * `prisma-migrate-deploy` / `prisma-generate` / `migrate-status` steps have
 * something to call (produced by `tools/scripts/package-backend-api.mjs`).
 * `prisma:migrate:deploy` and `prisma:generate` are issue #566's named
 * acceptance criterion; `prisma:migrate:status` is included too because
 * `HOST_APPLY_STEP_ORDER`'s last step depends on it existing just as much —
 * an assertion that only covered the first two would pass while that step
 * silently had nothing to call.
 */
export const REQUIRED_PACKAGER_PRISMA_SCRIPTS = Object.freeze([
  'prisma:migrate:deploy',
  'prisma:generate',
  'prisma:migrate:status',
] as const);

/**
 * Which of `REQUIRED_PACKAGER_PRISMA_SCRIPTS` are missing from the packager's
 * source text. Reads source rather than executing the packager: running it
 * needs a real `dist/apps/backend` build and shells out to `npm install`,
 * which is exactly the live-host-shaped dependency this engine's tests avoid.
 */
export function findMissingPackagerPrismaScripts(
  packagerSource: string,
): string[] {
  return REQUIRED_PACKAGER_PRISMA_SCRIPTS.filter(
    (name) => !packagerSource.includes(`'${name}':`),
  );
}
