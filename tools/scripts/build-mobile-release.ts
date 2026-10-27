#!/usr/bin/env node
// Builds the signed Android release APK with its signing key read from
// 1Password, so neither the keystore nor its password is ever on disk
// outside one throwaway folder for the length of one build (ADR 0127).
//
//   yarn mobile:release:build
//
// The keystore is a 1Password Document, and the password a field on a
// Password item. Their names default to the runbook's and can be changed:
//
//   MYORGANISER_OP_VAULT              default "Private"
//   MYORGANISER_OP_KEYSTORE_DOCUMENT  default "MyOrganiser release keystore"
//   MYORGANISER_OP_KEY_ITEM           default "MyOrganiser Android release key"
//
// The build reads its signing settings as the Gradle properties
// MYORGANISER_RELEASE_* (apps/mobile/android/app/build.gradle), which Gradle
// also takes from ORG_GRADLE_PROJECT_* environment variables. `op run` sets
// them for the Gradle process alone, resolving the password from 1Password
// and masking it in the output; `--no-daemon` keeps it out of a Gradle
// daemon that would outlive the build. The keystore copy is deleted whether
// the build passes or fails.
//
// Before building it deletes the native build caches (`.cxx`) of the app and
// of every package with Android code: `gradlew clean` leaves them, and one
// that points at a Gradle cache folder since removed fails CMake with
// "Imported target … includes non-existent path".
//
// It does not ask `op whoami` first: with the 1Password app integration,
// `whoami` reports "not signed in" until a command has unlocked a session,
// and it never asks for Touch ID itself. Fetching the keystore is what
// unlocks, so its own error is the one reported.
//
// Exit = Gradle's exit code. Exit 2 = could not start (1Password CLI missing,
// the keystore document not readable).
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { errorMessage } from './lib/error-message.ts';
import { spawnFailure } from './lib/spawn-failure.ts';

const ROOT = resolve('.');
const ANDROID_DIR = join(ROOT, 'apps', 'mobile', 'android');
const APK = join(
  ANDROID_DIR,
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk',
);

const vault = process.env.MYORGANISER_OP_VAULT ?? 'Private';
const keystoreDocument =
  process.env.MYORGANISER_OP_KEYSTORE_DOCUMENT ??
  'MyOrganiser release keystore';
const keyItem =
  process.env.MYORGANISER_OP_KEY_ITEM ?? 'MyOrganiser Android release key';

const fail = (message: string): never => {
  console.error(`mobile-release-build: ${message}`);
  process.exit(2);
};

if (!existsSync(join(ANDROID_DIR, 'gradlew'))) {
  fail(
    'run this from the repository root (apps/mobile/android/gradlew not found).',
  );
}

// The terminal is passed through, so the Touch ID prompt is tied to it.
const op = (args: string[]) =>
  execFileSync('op', args, {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });

try {
  op(['--version']);
} catch {
  fail('the 1Password CLI (op) is not installed: brew install 1password-cli.');
}

/** The `.cxx` native build caches of the app and of every Android package. */
function nativeBuildCaches(): string[] {
  const caches: string[] = [join(ANDROID_DIR, 'app', '.cxx')];
  const modules = join(ROOT, 'node_modules');
  const packages = existsSync(modules)
    ? readdirSync(modules).flatMap((name) =>
        name.startsWith('@')
          ? readdirSync(join(modules, name)).map((sub) =>
              join(modules, name, sub),
            )
          : [join(modules, name)],
      )
    : [];
  for (const dir of packages) caches.push(join(dir, 'android', '.cxx'));
  return caches.filter((dir) => existsSync(dir));
}

/**
 * The env file `op run` reads: each signing property as an
 * ORG_GRADLE_PROJECT_ variable. The password is an `op://` reference that
 * `op run` resolves, never the value itself.
 */
function signingEnvFile(keystorePath: string): string {
  const passwordReference = `op://${vault}/${keyItem}/password`;
  const settings: Record<string, string> = {
    STORE_FILE: keystorePath,
    STORE_PASSWORD: passwordReference,
    KEY_PASSWORD: passwordReference,
    KEY_ALIAS: 'myorganiser-release',
  };
  return Object.entries(settings)
    .map(
      ([name, value]) =>
        `ORG_GRADLE_PROJECT_MYORGANISER_RELEASE_${name}=${value}`,
    )
    .join('\n');
}

for (const cache of nativeBuildCaches()) {
  rmSync(cache, { recursive: true, force: true });
  console.log(`mobile-release-build: cleared ${cache}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'myorganiser-release-'));
let status = 2;
try {
  chmodSync(scratch, 0o700);
  const keystore = join(scratch, 'release.jks');
  try {
    op([
      'document',
      'get',
      keystoreDocument,
      '--vault',
      vault,
      '--out-file',
      keystore,
    ]);
  } catch (error) {
    throw new Error(
      [
        `could not read the document "${keystoreDocument}" from the vault "${vault}".`,
        `1Password said: ${spawnFailure(error).stderr.trim() || errorMessage(error)}`,
        'Check the 1Password app is unlocked with Settings → Developer → "Integrate with 1Password CLI" on, and that the document and vault names match (MYORGANISER_OP_VAULT, MYORGANISER_OP_KEYSTORE_DOCUMENT).',
      ].join('\n'),
    );
  }

  const envFile = join(scratch, 'release.env');
  writeFileSync(envFile, `${signingEnvFile(keystore)}\n`, { mode: 0o600 });

  const build = spawnSync(
    'op',
    [
      'run',
      `--env-file=${envFile}`,
      '--',
      './gradlew',
      '--no-daemon',
      'clean',
      'assembleRelease',
    ],
    { cwd: ANDROID_DIR, stdio: 'inherit' },
  );
  status = build.status ?? 2;
} catch (error) {
  console.error(`mobile-release-build: ${errorMessage(error)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (status === 0) {
  console.log(`\nmobile-release-build: signed APK at ${APK}`);
  console.log(
    'Next: check 16 KB alignment, try it on a device, then yarn mobile:release:publish --version X.Y.Z.',
  );
}
process.exit(status);
