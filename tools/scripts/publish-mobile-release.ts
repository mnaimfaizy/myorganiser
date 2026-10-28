#!/usr/bin/env node
// Publishes a Mobile Release from an APK the operator has already built and
// signed on their own Mac (ADR 0127). Run from the repository root:
//
//   yarn mobile:release:publish --version 1.0.0 [--apk <path>]
//
// What it checks, writes, and sends is in lib/mobile-release.ts. This file
// only wires it to the Android SDK's `apksigner` and `aapt2`, git, `gh`, and
// the file system. The runbook's "Publish to a GitHub Release" section
// (docs/deployment/MOBILE_RELEASE_PROCESS.md) says when to run it.
//
// Exit 0 = published. Exit 1 = refused, with the reason. Exit 2 = could not
// run (no Android SDK build-tools, `gh` failed).
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { errorMessage } from './lib/error-message.ts';
import { gh } from './lib/gh.ts';
import {
  DOWNLOAD_PAGE_VERSION_FILE,
  MobileReleaseRefusal,
  publishMobileRelease,
  releaseCreateArgs,
  sha256Of,
} from './lib/mobile-release.ts';
import { spawnFailure } from './lib/spawn-failure.ts';

function fail(message: string, code: number): never {
  console.error(`mobile-release: ${message}`);
  process.exit(code);
}

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const flags: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [name, inline] = arg.slice(2).split('=', 2);
    flags[name] = inline ?? argv[++i];
  }
  return flags;
}

/** The newest Android SDK build-tools directory that has `apksigner`. */
function buildTools(): string {
  const sdk =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    join(homedir(), 'Library', 'Android', 'sdk');
  const root = join(sdk, 'build-tools');
  if (!existsSync(root)) {
    fail(`no Android SDK build-tools under ${sdk}. Set ANDROID_HOME.`, 2);
  }
  const newest = readdirSync(root)
    .filter((dir) => existsSync(join(root, dir, 'apksigner')))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .pop();
  if (!newest) fail(`no build-tools under ${root} include apksigner.`, 2);
  return join(root, newest);
}

const run = (file: string, args: string[]) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const git = (args: string[]) => run('git', args).trim();

const flags = parseArgs(process.argv.slice(2));
const tools = buildTools();

try {
  const published = publishMobileRelease(
    { version: flags.version, apkPath: flags.apk },
    {
      exists: existsSync,
      // apksigner exits non-zero on an unsigned APK; what it printed still
      // says so, and the library refuses it as unsigned.
      printCertificates: (apk: string) => {
        try {
          return run(join(tools, 'apksigner'), [
            'verify',
            '--print-certs',
            apk,
          ]);
        } catch (error) {
          return spawnFailure(error).stdout;
        }
      },
      dumpBadging: (apk: string) =>
        run(join(tools, 'aapt2'), ['dump', 'badging', apk]),
      tagExists: (tag: string) => {
        const local = git(['tag', '--list', tag]);
        const remote = git([
          'ls-remote',
          '--tags',
          'origin',
          `refs/tags/${tag}`,
        ]);
        return local !== '' || remote !== '';
      },
      headCommit: () => {
        const head = git(['rev-parse', 'HEAD']);
        // Remote-tracking refs can be stale; ask the remote first.
        git(['fetch', '--quiet', 'origin']);
        // The tag is created on GitHub, so its commit must already be there.
        if (git(['branch', '-r', '--contains', head]) === '') {
          throw new MobileReleaseRefusal(
            `HEAD (${head.slice(0, 8)}) is not on the remote. Push it, then run this again.`,
          );
        }
        return head;
      },
      makeDir: (dir: string) => mkdirSync(dir, { recursive: true }),
      copyFile: copyFileSync,
      sha256: sha256Of,
      readFile: (path: string) => readFileSync(path, 'utf8'),
      writeFile: (path: string, contents: string) =>
        writeFileSync(path, contents),
      createRelease: (release) => gh(releaseCreateArgs(release)),
    },
  );
  console.log(
    `mobile-release: published ${published.tag} at ${published.target}`,
  );
  for (const file of published.files) console.log(`  attached ${file}`);
  console.log(`  SHA-256 ${published.sha256}`);
  console.log(
    `\nThe download page now names this version. Commit ${DOWNLOAD_PAGE_VERSION_FILE}; it goes live with the next web Release.`,
  );
} catch (error) {
  if (error instanceof MobileReleaseRefusal) fail(error.message, 1);
  fail(
    `could not publish: ${spawnFailure(error).stderr.trim() || errorMessage(error)}`,
    2,
  );
}
