import archiver from 'archiver';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = path.resolve(__dirname, '..', '..');

function rm(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function mkdir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src: string, dst: string): void {
  fs.cpSync(src, dst, { recursive: true });
}

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function log(msg: string): void {
  console.log(msg);
}

function run(cmd: string, cwd: string = workspaceRoot): void {
  log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
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

    // Include dotfiles (e.g. .next) and avoid zipping the zip itself.
    archive.glob('**/*', {
      cwd: dir,
      dot: true,
      ignore: [path.basename(outFile)],
    });

    archive.finalize();
  });
}

// Next's default distDir, inside the app: `distDir` may not leave the project
// directory, so the build no longer writes to dist/ (ADR 0083).
const appDir = path.join(workspaceRoot, 'apps', 'web');
const nextDir = path.join(appDir, '.next');
const standaloneDir = path.join(nextDir, 'standalone');
const staticDir = path.join(nextDir, 'static');

const deployRoot = path.join(workspaceRoot, 'dist', 'deploy', 'web');

if (!exists(standaloneDir)) {
  throw new Error(
    `Expected Next standalone output at: ${standaloneDir}. ` +
      `Ensure apps/web/next.config.js has output: 'standalone' and re-run the build.`,
  );
}

// Clean deploy output
rm(deployRoot);
mkdir(deployRoot);

// IMPORTANT:
// Next's generated standalone `server.js` can embed OS-specific paths (e.g. Windows backslashes)
// via `required-server-files.json`. That can break on Linux shared hosting.
//
// To keep the bundle Linux-safe:
//   - do NOT ship `node_modules` (cPanel will run `npm install`)
//   - generate a deploy-only package.json automatically from `.next/standalone/node_modules`
//   - copy build output `.next` into deployRoot/.next (including server + required-server-files.json)
//   - generate our own deployRoot/server.js that overrides distDir to `.next`

const standaloneNodeModules = path.join(standaloneDir, 'node_modules');
if (!exists(standaloneNodeModules)) {
  throw new Error(
    `Expected standalone node_modules at: ${standaloneNodeModules}`,
  );
}

/** The one shape read off a dependency's `package.json` to decide whether to ship it. */
interface PackageJsonLike {
  version?: string;
  os?: string | string[];
  cpu?: string | string[];
}

function readJson(file: string): PackageJsonLike {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJsonLike;
}

function isLinuxX64Compatible(pkgJson: PackageJsonLike): boolean {
  // If a package declares os/cpu constraints, only include it if it supports linux+x64.
  // Otherwise we risk generating a package.json that hard-requires Windows-only binaries.
  const os = pkgJson?.os;
  const cpu = pkgJson?.cpu;

  const osList =
    typeof os === 'string' ? [os] : Array.isArray(os) ? os : undefined;
  const cpuList =
    typeof cpu === 'string' ? [cpu] : Array.isArray(cpu) ? cpu : undefined;

  const matchesLinux = (value: string) =>
    value === 'linux' || value.startsWith('linux-');
  const matchesX64 = (value: string) =>
    value === 'x64' || value === 'x86_64' || value === 'amd64';

  const isAllowed = (
    list: string[] | undefined,
    matcher: (value: string) => boolean,
  ): boolean => {
    if (!list) return true;

    const positives = list.filter((v) => !String(v).startsWith('!'));
    const negatives = list
      .filter((v) => String(v).startsWith('!'))
      .map((v) => String(v).slice(1));

    if (positives.length > 0) {
      return positives.some((v) => matcher(String(v)));
    }

    return !negatives.some((v) => matcher(String(v)));
  };

  return isAllowed(osList, matchesLinux) && isAllowed(cpuList, matchesX64);
}

function listStandalonePackages(
  nodeModulesDir: string,
): Record<string, string> {
  const dependencies: Record<string, string> = {};
  const entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.bin') continue;
    if (entry.name.startsWith('.')) continue;

    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entry.name);
      const scoped = fs.readdirSync(scopeDir, { withFileTypes: true });
      for (const scopedEntry of scoped) {
        if (!scopedEntry.isDirectory()) continue;
        const pkgName = `${entry.name}/${scopedEntry.name}`;
        const pkgJsonPath = path.join(
          scopeDir,
          scopedEntry.name,
          'package.json',
        );
        if (!exists(pkgJsonPath)) continue;
        const pkgJson = readJson(pkgJsonPath);
        if (!pkgJson?.version) continue;
        if (!isLinuxX64Compatible(pkgJson)) continue;
        dependencies[pkgName] = pkgJson.version;
      }
      continue;
    }

    const pkgJsonPath = path.join(nodeModulesDir, entry.name, 'package.json');
    if (!exists(pkgJsonPath)) continue;
    const pkgJson = readJson(pkgJsonPath);
    if (!pkgJson?.version) continue;
    if (!isLinuxX64Compatible(pkgJson)) continue;
    dependencies[entry.name] = pkgJson.version;
  }

  // Ensure stable output
  return Object.fromEntries(
    Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
}

const deployDependencies = listStandalonePackages(standaloneNodeModules);

fs.writeFileSync(
  path.join(deployRoot, 'package.json'),
  JSON.stringify(
    {
      name: 'web',
      private: true,
      scripts: {
        start: 'node server.js',
      },
      dependencies: deployDependencies,
    },
    null,
    2,
  ),
  'utf8',
);

if (!exists(nextDir)) {
  throw new Error(`Expected Next build output folder at: ${nextDir}`);
}

copyDir(nextDir, path.join(deployRoot, '.next'));

// Remove standalone output from within the deploy's .next (we already copied node_modules from it)
rm(path.join(deployRoot, '.next', 'standalone'));
// Remove cache to reduce upload size
rm(path.join(deployRoot, '.next', 'cache'));

if (!exists(staticDir)) {
  throw new Error(`Expected Next static assets at: ${staticDir}`);
}

const publicFromApp = path.join(appDir, 'public');

if (exists(publicFromApp)) {
  copyDir(publicFromApp, path.join(deployRoot, 'public'));
}

// Linux-safe server.js for cPanel startup.
// Uses the Next internal startServer helper, but forces distDir to `.next`.
fs.writeFileSync(
  path.join(deployRoot, 'server.js'),
  [
    "const path = require('path');",
    '',
    "process.env.NODE_ENV = process.env.NODE_ENV || 'production';",
    'process.chdir(__dirname);',
    '',
    "const hostname = process.env.HOSTNAME || '0.0.0.0';",
    'const port = parseInt(process.env.PORT, 10) || 3000;',
    '',
    'let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);',
    'if (Number.isNaN(keepAliveTimeout) || !Number.isFinite(keepAliveTimeout) || keepAliveTimeout < 0) {',
    '  keepAliveTimeout = undefined;',
    '}',
    '',
    '// Load Next config captured during build and sanitize OS-specific paths.',
    "const required = require('./.next/required-server-files.json');",
    'const nextConfig = Object.assign({}, required.config || {});',
    "nextConfig.distDir = '.next';",
    'nextConfig.experimental = Object.assign({}, nextConfig.experimental || {});',
    'nextConfig.experimental.outputFileTracingRoot = __dirname;',
    '',
    'process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);',
    '',
    "require('next');",
    "const { startServer } = require('next/dist/server/lib/start-server');",
    '',
    'startServer({',
    '  dir: __dirname,',
    '  isDev: false,',
    '  config: nextConfig,',
    '  hostname,',
    '  port,',
    '  allowRetry: false,',
    '  keepAliveTimeout,',
    '}).catch((err) => {',
    '  console.error(err);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n'),
  'utf8',
);

// Create a tiny README to reduce operator error on cPanel.
fs.writeFileSync(
  path.join(deployRoot, 'CPANEL_STARTUP.md'),
  [
    '# cPanel startup',
    '',
    '- Startup file: `server.js`',
    '- Node.js app root: this folder',
    '- Run: `npm install` (this bundle does not include `node_modules`)',
    '- Recommended env vars:',
    '  - `NODE_ENV=production`',
    '  - `PORT=3000` (or set by cPanel)',
    '  - `API_BASE_URL=https://api.myorganiser.app/api/v1` (runtime; preferred)',
    '  - `NEXT_PUBLIC_API_BASE_URL=https://api.myorganiser.app/api/v1` (fallback)',
    '',
    'Notes:',
    '- This bundle is packaged to avoid Windows-specific paths in Next standalone output.',
    '- If you change API base URL, prefer updating `API_BASE_URL` and restarting the app.',
    '',
  ].join('\n'),
  'utf8',
);

// Optional: create a zip if `zip` exists on the system.
// (Windows users might not have it; docs cover using File Explorer/7zip instead.)
try {
  run(`zip -r web.zip .`, deployRoot);
  log(`Created archive: ${path.join(deployRoot, 'web.zip')}`);
} catch {
  try {
    const outFile = path.join(deployRoot, 'web.zip');
    await createZipFromDir({ dir: deployRoot, outFile });
    log(`Created archive: ${outFile}`);
  } catch (err) {
    log(
      'zip command not available and JS zip fallback failed; skipping archive creation.',
    );
    log(String(err));
    log(`Deploy folder ready at: ${deployRoot}`);
  }
}
