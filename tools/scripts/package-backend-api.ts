import archiver from 'archiver';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = path.resolve(__dirname, '..', '..');

/** The one shape read off a `package.json` this script inspects or writes. */
interface PackageJsonLike {
  main?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  overrides?: unknown;
  [key: string]: unknown;
}

function rm(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function mkdir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src: string, dst: string): void {
  fs.cpSync(src, dst, { recursive: true });
}

function copyFile(src: string, dst: string): void {
  fs.copyFileSync(src, dst);
}

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function readJson(file: string): PackageJsonLike {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJsonLike;
}

function writeJson(file: string, obj: unknown): void {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function log(msg: string): void {
  console.log(msg);
}

function runNpm(args: string[], cwd: string): void {
  const npmCmd = 'npm';
  log(`> ${npmCmd} ${args.join(' ')}`);
  execFileSync(npmCmd, args, {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
}

function createZipFromDir({
  dir,
  outFile,
}: {
  dir: string;
  outFile: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);

    // Include dotfiles and avoid zipping the zip itself.
    archive.glob('**/*', {
      cwd: dir,
      dot: true,
      ignore: [path.basename(outFile)],
    });

    archive.finalize();
  });
}

const buildOut = path.join(workspaceRoot, 'dist', 'apps', 'backend');
const deployRoot = path.join(workspaceRoot, 'dist', 'deploy', 'backend-api');

const prismaSrc = path.join(workspaceRoot, 'apps', 'backend', 'src', 'prisma');

const backendDistPackageJson = path.join(buildOut, 'package.json');

if (!exists(buildOut) || !exists(backendDistPackageJson)) {
  throw new Error(
    `Expected backend build output at: ${buildOut}. ` +
      `Run: yarn build:backend`,
  );
}

// Clean deploy output
rm(deployRoot);
mkdir(deployRoot);

// Copy backend build output (no node_modules)
for (const entry of fs.readdirSync(buildOut, { withFileTypes: true })) {
  const srcPath = path.join(buildOut, entry.name);
  const dstPath = path.join(deployRoot, entry.name);

  // We always generate a deploy-specific package.json below.
  if (entry.name === 'package.json') continue;

  if (entry.isDirectory()) {
    copyDir(srcPath, dstPath);
  } else if (entry.isFile()) {
    copyFile(srcPath, dstPath);
  }
}

// Copy Prisma folder for deploy-time generate/migrate on Linux.
// IMPORTANT: do NOT copy prisma-client (it contains Windows-generated engine binaries and paths).
if (exists(prismaSrc)) {
  copyDir(prismaSrc, path.join(deployRoot, 'prisma'));
  rm(path.join(deployRoot, 'prisma', 'prisma-client'));
}

const distPkg = readJson(backendDistPackageJson);
const rootPkg = readJson(path.join(workspaceRoot, 'package.json'));

const rootPrismaVersion =
  rootPkg?.dependencies?.prisma || rootPkg?.devDependencies?.prisma;
const rootPrismaClientVersion =
  rootPkg?.dependencies?.['@prisma/client'] ||
  rootPkg?.devDependencies?.['@prisma/client'];

const rootTslibVersion =
  rootPkg?.dependencies?.tslib || rootPkg?.devDependencies?.tslib;

// Start from Nx-generated runtime deps and filter obvious non-runtime deps.
const filteredDeps: Record<string, string> = {
  ...(distPkg.dependencies || {}),
};
for (const name of Object.keys(filteredDeps)) {
  if (name === '@jest/globals' || name.startsWith('jest')) {
    delete filteredDeps[name];
  }
}

// Ensure Prisma runtime deps exist (now that we export from @prisma/client).
if (rootPrismaClientVersion) {
  filteredDeps['@prisma/client'] = rootPrismaClientVersion;
}

// Include Prisma CLI so postinstall can generate the client on the target Linux host.
if (rootPrismaVersion) {
  filteredDeps.prisma = rootPrismaVersion;
}

// Webpack output can require tslib at runtime; ensure it's present in deploy deps.
if (!filteredDeps.tslib && rootTslibVersion) {
  filteredDeps.tslib = rootTslibVersion;
}

/** The deploy bundle's own `package.json`, written by `writeJson` below. */
interface DeployPackageJson {
  name: string;
  private: boolean;
  main: string;
  engines?: { node: string };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  overrides?: unknown;
  [key: string]: unknown;
}

const deployPkg: DeployPackageJson = {
  name: 'backend-api',
  private: true,
  main: distPkg.main || 'main.js',
  engines: rootPkg?.engines?.node ? { node: rootPkg.engines.node } : undefined,
  scripts: {
    start: `node ${distPkg.main || 'main.js'}`,
    'prisma:generate': 'prisma generate --config prisma.config.cjs',
    'prisma:migrate:deploy': 'prisma migrate deploy --config prisma.config.cjs',
    'prisma:migrate:status': 'prisma migrate status --config prisma.config.cjs',
  },
  dependencies: Object.fromEntries(
    Object.entries(filteredDeps).sort(([a], [b]) => a.localeCompare(b)),
  ),
  overrides: rootPkg.overrides,
};

for (const key of Object.keys(deployPkg)) {
  if (deployPkg[key] === undefined) {
    delete deployPkg[key];
  }
}

// cPanel/shared-hosting friendly: generate Prisma client for the server OS.
// Must be resilient if npm executes scripts from nodevenv/lib (cPanel quirk).
const postinstallScriptRelPath = 'scripts/postinstall.cjs';
const postinstallScriptAbsPath = path.join(
  deployRoot,
  ...postinstallScriptRelPath.split('/'),
);
mkdir(path.dirname(postinstallScriptAbsPath));

const postinstallScript = [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  "const { spawnSync } = require('child_process');",
  '',
  'const npmPackageJson = process.env.npm_package_json;',
  'const npmPackageDir = npmPackageJson ? path.dirname(npmPackageJson) : undefined;',
  'const passengerRoot = process.env.PASSENGER_APP_ROOT;',
  '',
  'const candidates = [',
  '  npmPackageDir,',
  '  passengerRoot,',
  '  process.env.INIT_CWD,',
  '  process.env.npm_config_local_prefix,',
  '  process.env.PWD,',
  '  process.cwd(),',
  '  __dirname,',
  '].filter(Boolean);',
  '',
  "const hasPkg = (d) => fs.existsSync(path.join(d, 'package.json'));",
  "const hasSchema = (d) => fs.existsSync(path.join(d, 'prisma', 'schema'));",
  '',
  'const appRoot =',
  '  candidates.find((d) => hasPkg(d) && hasSchema(d)) ||',
  '  candidates.find(hasPkg) ||',
  '  process.cwd();',
  '',
  "const schemaDir = path.join(appRoot, 'prisma', 'schema');",
  "console.log('[postinstall] appRoot:', appRoot);",
  "console.log('[postinstall] schemaDir:', schemaDir);",
  "console.log('[postinstall] npm_package_json:', process.env.npm_package_json || '');",
  "console.log('[postinstall] PASSENGER_APP_ROOT:', process.env.PASSENGER_APP_ROOT || '');",
  '',
  'if (!fs.existsSync(schemaDir)) {',
  "  console.log('[postinstall] Skipping prisma generate: prisma/schema not found at', schemaDir);",
  "  console.log('[postinstall] cwd:', process.cwd());",
  '  process.exit(0);',
  '}',
  '',
  "const prismaBin = path.join(appRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');",
  "const args = ['generate', '--config', 'prisma.config.cjs'];",
  'let r;',
  '',
  'if (fs.existsSync(prismaBin)) {',
  "  r = spawnSync(prismaBin, args, { stdio: 'inherit', cwd: appRoot });",
  '} else {',
  "  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';",
  "  r = spawnSync(npx, ['prisma', ...args], { stdio: 'inherit', cwd: appRoot });",
  '}',
  '',
  'process.exit(r.status ?? 1);',
  '',
].join('\n');

fs.writeFileSync(postinstallScriptAbsPath, `${postinstallScript}\n`, 'utf8');

const deployPrismaConfig = [
  "'use strict';",
  "require('dotenv/config');",
  "const { defineConfig, env } = require('prisma/config');",
  '',
  "const isGenerate = process.argv.includes('generate');",
  'const datasourceUrl =',
  '  process.env.DATABASE_URL ||',
  "  (isGenerate ? 'postgresql://localhost:5432/myorganiser' : env('DATABASE_URL'));",
  '',
  'module.exports = defineConfig({',
  "  schema: 'prisma/schema',",
  '  datasource: {',
  '    url: datasourceUrl,',
  '  },',
  '  migrations: {',
  "    path: 'prisma/migrations',",
  '  },',
  '});',
  '',
].join('\n');

fs.writeFileSync(
  path.join(deployRoot, 'prisma.config.cjs'),
  deployPrismaConfig,
  'utf8',
);

// cPanel sometimes runs npm scripts from nodevenv/.../lib and can set npm_package_json
// to nodevenv/lib/package.json, so resolving files relative to npm_package_json is unreliable.
// Instead: locate the deployed bundle root (INIT_CWD / Passenger envs) and require the
// already-generated scripts/postinstall.cjs from there.
deployPkg.scripts.postinstall =
  "node -e \"const fs=require('fs');const path=require('path');const candidates=[process.env.INIT_CWD,process.env.PASSENGER_APP_ROOT,process.env.npm_config_local_prefix,process.env.PWD,process.cwd()].filter(Boolean);const scriptPath=(candidates.map((d)=>path.join(d,'scripts','postinstall.cjs')).find((p)=>fs.existsSync(p)))||path.join(process.cwd(),'scripts','postinstall.cjs');if(!fs.existsSync(scriptPath)){console.log('[postinstall] scripts/postinstall.cjs not found; skipping (likely cPanel ran install from nodevenv/lib)');console.log('[postinstall] cwd:',process.cwd());console.log('[postinstall] INIT_CWD:',process.env.INIT_CWD||'');console.log('[postinstall] PASSENGER_APP_ROOT:',process.env.PASSENGER_APP_ROOT||'');process.exit(0);}require(scriptPath);\"";

writeJson(path.join(deployRoot, 'package.json'), deployPkg);

const rootNpmrc = path.join(workspaceRoot, '.npmrc');
if (exists(rootNpmrc)) {
  copyFile(rootNpmrc, path.join(deployRoot, '.npmrc'));
}

// Generate a deploy-only npm lockfile for cPanel. The source repo remains
// Yarn-authoritative; this lockfile exists only inside dist/deploy/backend-api
// so cPanel can install deterministically with `npm ci --omit=dev`.
runNpm(
  ['install', '--package-lock-only', '--ignore-scripts', '--omit=dev'],
  deployRoot,
);

if (!exists(path.join(deployRoot, 'package-lock.json'))) {
  throw new Error(
    'Expected npm to generate package-lock.json for backend deploy bundle.',
  );
}

fs.writeFileSync(
  path.join(deployRoot, 'CPANEL_STARTUP.md'),
  [
    '# cPanel backend startup',
    '',
    '- Startup file: `main.js`',
    '- Node.js app root: this folder',
    '- Run: `npm ci --omit=dev` (required; this bundle includes a deploy-only `package-lock.json`, npm guardrail config, and no `node_modules`)',
    '- Recommended env vars:',
    '  - `NODE_ENV=production`',
    '  - `PORT=3000` (or set by cPanel)',
    '  - `DATABASE_URL=postgresql://...`',
    '  - `CORS_ORIGINS=https://myorganiser.app`',
    '',
    'Notes:',
    '- `npm ci --omit=dev` runs `postinstall`, which runs `prisma generate` (when `prisma/schema` exists) so Prisma is built for the server OS.',
    '- `prisma.config.cjs` reads `DATABASE_URL` from the process environment or an app-root `.env` file for migrations.',
    '- If you run Prisma commands from SSH, make sure that shell can read `DATABASE_URL`; cPanel app environment variables may not be inherited by SSH sessions.',
    '- `postinstall` is resilient to cPanel running npm scripts from `nodevenv/.../lib` by using `INIT_CWD`/prefix envs.',
    '- Do not replace `npm ci --omit=dev` with `npm install` for staging or production deployments.',
    '- To apply DB migrations on the server, run: `npm run prisma:migrate:deploy`.',
    '- To verify nothing is pending after a migrate, run: `npm run prisma:migrate:status`.',
    '',
  ].join('\n'),
  'utf8',
);

const zipPath = path.join(deployRoot, 'backend-api.zip');
await createZipFromDir({ dir: deployRoot, outFile: zipPath });
log(`Created archive: ${zipPath}`);
log(`Deploy folder ready at: ${deployRoot}`);
