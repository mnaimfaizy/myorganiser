/**
 * Contract suite for mobile-release.mjs (ADR 0127: the publish command refuses
 * what it must and publishes what it may, and the GitHub call is mocked).
 *
 * Every refusal is driven through the injected `deps` with a fake for each
 * effect, and each one is proved to run before any write or Release call. The
 * success path runs against a real temporary directory with real APK bytes,
 * so the checksum and copied file are checked against an independent hash.
 * The download page and the web Release workflow are checked as text, since
 * they are the other half of the contract this module must keep.
 */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { mock, type Mock } from 'node:test';

import {
  DOWNLOAD_PAGE_VERSION_FILE,
  MobileReleaseRefusal,
  checksumLine,
  mobileReleaseTag,
  parseSignerDigests,
  parseVersionName,
  publishMobileRelease,
  releaseApkName,
  releaseCreateArgs,
  sha256Of,
  withCurrentMobileRelease,
  type MobileReleaseCreateArgs,
  type MobileReleaseDeps,
} from './mobile-release.ts';

type FakeMobileReleaseDeps = {
  [K in keyof MobileReleaseDeps]: Mock<MobileReleaseDeps[K]>;
};

const APK = 'out/app-release.apk';
const EFFECTS = ['makeDir', 'copyFile', 'writeFile', 'createRelease'];
const HEAD = 'abc123def456';

// The debug keystore's certificate, as apksigner prints it.
const DEBUG_SIGNER =
  'V2 Signer: certificate SHA-256 digest: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';
const RELEASE_SIGNER = `V2 Signer: certificate SHA-256 digest: ${'ab'.repeat(32)}`;

const badging = (versionName: string): string =>
  `package: name='app.myorganiser' versionCode='1' versionName='${versionName}' platformBuildVersionName='17'`;

const PAGE_SOURCE = readFileSync(resolve(DOWNLOAD_PAGE_VERSION_FILE), 'utf8');

/** Every effect faked: a valid signed 1.0.0 APK, no tag, nothing written. */
function fakeDeps(
  overrides: Partial<FakeMobileReleaseDeps> = {},
): FakeMobileReleaseDeps {
  return {
    exists: mock.fn((_path: string) => true),
    printCertificates: mock.fn((_apkPath: string) => RELEASE_SIGNER),
    dumpBadging: mock.fn((_apkPath: string) => badging('1.0.0')),
    tagExists: mock.fn((_tag: string) => false),
    headCommit: mock.fn(() => HEAD),
    makeDir: mock.fn((_dir: string) => undefined),
    copyFile: mock.fn((_src: string, _dest: string) => undefined),
    sha256: mock.fn((_path: string) => 'unused'),
    readFile: mock.fn((_path: string) => PAGE_SOURCE),
    writeFile: mock.fn((_path: string, _contents: string) => undefined),
    createRelease: mock.fn((_release: MobileReleaseCreateArgs) => undefined),
    ...overrides,
  };
}

/** Runs `run`, requires a MobileReleaseRefusal naming `pattern`, and that no effect ran. */
function assertRefused(
  run: () => void,
  pattern: RegExp,
  deps: FakeMobileReleaseDeps,
): MobileReleaseRefusal {
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  assert.ok(
    error instanceof MobileReleaseRefusal,
    `expected a MobileReleaseRefusal, got ${error}`,
  );
  assert.match(error.message, pattern);
  for (const name of EFFECTS) {
    assert.equal(
      deps[name as keyof FakeMobileReleaseDeps].mock.callCount(),
      0,
      `${name} must not run`,
    );
  }
  return error;
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mobile-release-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Real file system for the APK and checksum; the download page file is in
 * memory. `log` records the order of the Release call and the page write.
 */
function realFsDeps(
  createReleaseImpl: (release: MobileReleaseCreateArgs) => unknown = () =>
    undefined,
) {
  const page: { source: string; written: string | null } = {
    source: PAGE_SOURCE,
    written: null,
  };
  const log: string[] = [];
  const createRelease = mock.fn((release: MobileReleaseCreateArgs) => {
    log.push('createRelease');
    return createReleaseImpl(release);
  });
  const deps: MobileReleaseDeps = {
    exists: (path) => existsSync(path),
    printCertificates: () => RELEASE_SIGNER,
    dumpBadging: () => badging('1.0.0'),
    tagExists: () => false,
    headCommit: () => HEAD,
    makeDir: (path) => mkdirSync(path, { recursive: true }),
    copyFile: (from, to) => copyFileSync(from, to),
    sha256: sha256Of,
    readFile: (path) => {
      if (path === DOWNLOAD_PAGE_VERSION_FILE) return page.source;
      return readFileSync(path, 'utf8');
    },
    writeFile: (path, content) => {
      if (path === DOWNLOAD_PAGE_VERSION_FILE) {
        log.push('writePage');
        page.written = content;
        return;
      }
      writeFileSync(path, content);
    },
    createRelease,
  };
  return { deps, page, createRelease, log };
}

// ------------------------------------------------------------------ refusals

for (const version of ['1.0', '01.0.0', '1.0.0-beta', undefined]) {
  test(`refuses version ${String(version)} as not X.Y.Z, touching nothing`, () => {
    const deps = fakeDeps();
    const error = assertRefused(
      () => publishMobileRelease({ version, apkPath: APK }, deps),
      /is not a Mobile Release version/,
      deps,
    );
    assert.ok(
      error.message.startsWith(
        `"${version ?? ''}" is not a Mobile Release version`,
      ),
      `message names the bad value: ${error.message}`,
    );
  });
}

test('refuses a missing APK, before any signing is inspected', () => {
  const deps = fakeDeps({ exists: mock.fn(() => false) });
  assertRefused(
    () => publishMobileRelease({ version: '1.0.0', apkPath: APK }, deps),
    /No APK at out\/app-release\.apk/,
    deps,
  );
  assert.equal(deps.printCertificates.mock.callCount(), 0);
});

test('refuses an APK signed only with the public debug key', () => {
  const deps = fakeDeps({
    printCertificates: mock.fn(() => DEBUG_SIGNER),
  });
  assertRefused(
    () => publishMobileRelease({ version: '1.0.0', apkPath: APK }, deps),
    /signed with the public debug key/,
    deps,
  );
});

test('refuses an APK that also carries a release signer when the debug key signed it', () => {
  const deps = fakeDeps({
    printCertificates: mock.fn(() => `${RELEASE_SIGNER}\n${DEBUG_SIGNER}`),
  });
  assertRefused(
    () => publishMobileRelease({ version: '1.0.0', apkPath: APK }, deps),
    /public debug key/,
    deps,
  );
});

test('refuses an unsigned APK', () => {
  const deps = fakeDeps({ printCertificates: mock.fn(() => '') });
  assertRefused(
    () => publishMobileRelease({ version: '1.0.0', apkPath: APK }, deps),
    /out\/app-release\.apk is not signed/,
    deps,
  );
});

test('refuses an APK built as another version, naming both versions', () => {
  const deps = fakeDeps({
    dumpBadging: mock.fn(() => badging('1.0.1')),
  });
  assertRefused(
    () => publishMobileRelease({ version: '1.0.0', apkPath: APK }, deps),
    /is version 1\.0\.1, not 1\.0\.0/,
    deps,
  );
});

test('refuses an APK whose badging has no versionName, as unknown', () => {
  const deps = fakeDeps({
    dumpBadging: mock.fn(
      () => "package: name='app.myorganiser' versionCode='1'",
    ),
  });
  assertRefused(
    () => publishMobileRelease({ version: '1.0.0', apkPath: APK }, deps),
    /is version \(unknown\), not 1\.0\.0/,
    deps,
  );
});

test('refuses a version whose mobile-v tag already exists', () => {
  const deps = fakeDeps({ tagExists: mock.fn(() => true) });
  assertRefused(
    () => publishMobileRelease({ version: '1.0.0', apkPath: APK }, deps),
    /Tag mobile-v1\.0\.0 already exists/,
    deps,
  );
  assert.deepEqual(deps.tagExists.mock.calls[0].arguments, ['mobile-v1.0.0']);
});

test('propagates the refusal when HEAD is not on the remote, touching nothing', () => {
  const deps = fakeDeps({
    headCommit: mock.fn(() => {
      throw new MobileReleaseRefusal(
        'HEAD (abc123de) is not on the remote. Push it, then run this again.',
      );
    }),
  });
  assertRefused(
    () => publishMobileRelease({ version: '1.0.0', apkPath: APK }, deps),
    /is not on the remote/,
    deps,
  );
  assert.equal(deps.headCommit.mock.callCount(), 1);
});

test('refuses a download page with no CURRENT_MOBILE_RELEASE declaration, before any effect', () => {
  const deps = fakeDeps({
    readFile: mock.fn(() => 'export const OTHER = 1;\n'),
  });
  const error = assertRefused(
    () => publishMobileRelease({ version: '1.0.0', apkPath: APK }, deps),
    /has no CURRENT_MOBILE_RELEASE declaration to update/,
    deps,
  );
  assert.ok(error.message.includes(DOWNLOAD_PAGE_VERSION_FILE));
  assert.equal(deps.createRelease.mock.callCount(), 0);
});

// ------------------------------------------------------------------- success

test('leaves the download page untouched when the Release call fails', () => {
  withTempDir((dir) => {
    const apkPath = join(dir, 'app-release.apk');
    writeFileSync(apkPath, Buffer.from('signed apk bytes'));
    const outDir = join(dir, 'out');
    const { deps, page, createRelease, log } = realFsDeps(() => {
      throw new Error('gh release create failed');
    });

    assert.throws(
      () => publishMobileRelease({ version: '1.0.0', apkPath, outDir }, deps),
      /gh release create failed/,
    );
    assert.equal(createRelease.mock.callCount(), 1);
    assert.equal(page.written, null);
    assert.deepEqual(log, ['createRelease']);
  });
});

test('copies the APK and writes its SHA-256 checksum beside it', () => {
  withTempDir((dir) => {
    const apkPath = join(dir, 'app-release.apk');
    const bytes = Buffer.from('signed apk bytes');
    writeFileSync(apkPath, bytes);
    const outDir = join(dir, 'out');
    const { deps } = realFsDeps();

    publishMobileRelease({ version: '1.0.0', apkPath, outDir }, deps);

    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(
      readFileSync(join(outDir, 'myorganiser-1.0.0.apk')),
      bytes,
    );
    assert.equal(
      readFileSync(join(outDir, 'myorganiser-1.0.0.apk.sha256'), 'utf8'),
      `${expected}  myorganiser-1.0.0.apk\n`,
    );
  });
});

test('creates the Release with both files, then points the download page at it', () => {
  withTempDir((dir) => {
    const apkPath = join(dir, 'app-release.apk');
    writeFileSync(apkPath, Buffer.from('signed apk bytes'));
    const outDir = join(dir, 'out');
    const { deps, page, createRelease, log } = realFsDeps();

    const result = publishMobileRelease(
      { version: '1.0.0', apkPath, outDir },
      deps,
    );

    const apkOut = join(outDir, 'myorganiser-1.0.0.apk');
    const checksumOut = `${apkOut}.sha256`;
    assert.equal(createRelease.mock.callCount(), 1);
    assert.deepEqual(log, ['createRelease', 'writePage']);
    const release = createRelease.mock.calls[0].arguments[0];
    assert.equal(release.tag, 'mobile-v1.0.0');
    assert.equal(release.target, HEAD);
    assert.deepEqual(release.files, [apkOut, checksumOut]);

    assert.equal(page.written, withCurrentMobileRelease(PAGE_SOURCE, '1.0.0'));
    assert.match(
      page.written,
      /export const CURRENT_MOBILE_RELEASE: string \| null = '1\.0\.0';/,
    );

    assert.equal(result.tag, 'mobile-v1.0.0');
    assert.equal(result.target, HEAD);
    assert.equal(result.sha256, sha256Of(apkOut));
    assert.deepEqual(result.files, [apkOut, checksumOut]);
  });
});

// ------------------------------------------------- withCurrentMobileRelease

test('sets a null CURRENT_MOBILE_RELEASE to the new version', () => {
  const source = 'export const CURRENT_MOBILE_RELEASE: string | null = null;\n';
  assert.equal(
    withCurrentMobileRelease(source, '1.0.0'),
    "export const CURRENT_MOBILE_RELEASE: string | null = '1.0.0';\n",
  );
});

test('replaces a previous CURRENT_MOBILE_RELEASE version', () => {
  const source =
    "export const CURRENT_MOBILE_RELEASE: string | null = '0.9.0';\n";
  assert.equal(
    withCurrentMobileRelease(source, '1.0.0'),
    "export const CURRENT_MOBILE_RELEASE: string | null = '1.0.0';\n",
  );
});

test('refuses a source with no CURRENT_MOBILE_RELEASE declaration', () => {
  assert.throws(
    () => withCurrentMobileRelease('export const OTHER = 1;\n', '1.0.0'),
    (error) =>
      error instanceof MobileReleaseRefusal &&
      error.message.includes(DOWNLOAD_PAGE_VERSION_FILE) &&
      /CURRENT_MOBILE_RELEASE declaration/.test(error.message),
  );
});

test('rewrites the committed download page file and keeps it rewritable', () => {
  const once = withCurrentMobileRelease(PAGE_SOURCE, '1.0.0');
  assert.match(
    once,
    /export const CURRENT_MOBILE_RELEASE: string \| null = '1\.0\.0';/,
  );
  assert.equal(once.split('\n').length, PAGE_SOURCE.split('\n').length);

  const twice = withCurrentMobileRelease(once, '1.0.1');
  assert.match(
    twice,
    /export const CURRENT_MOBILE_RELEASE: string \| null = '1\.0\.1';/,
  );
  assert.doesNotMatch(twice, /'1\.0\.0'/);
});

// ----------------------------------------------------------------- parsing

test('collects every signer SHA-256 digest, lowercased', () => {
  const output = [
    `V2 Signer: certificate SHA-256 digest: ${'AB'.repeat(32)}`,
    `V2 Signer: certificate SHA-256 digest: ${'0123'.repeat(16)}`,
  ].join('\n');
  assert.deepEqual(parseSignerDigests(output), [
    'ab'.repeat(32),
    '0123'.repeat(16),
  ]);
});

test('reads versionName from a real aapt2 badging line, and null without one', () => {
  assert.equal(
    parseVersionName(
      "package: name='app.myorganiser' versionCode='1' versionName='1.0.0' platformBuildVersionName='17'",
    ),
    '1.0.0',
  );
  assert.equal(
    parseVersionName("package: name='app.myorganiser' versionCode='1'"),
    null,
  );
});

// ------------------------------------------------------ releaseCreateArgs

const CREATE_INPUT = {
  tag: 'mobile-v1.0.0',
  target: HEAD,
  title: 'MyOrganiser 1.0.0 for Android',
  notes: 'notes',
  files: ['out/myorganiser-1.0.0.apk', 'out/myorganiser-1.0.0.apk.sha256'],
};

test('starts with the tag, then attaches both files', () => {
  const args = releaseCreateArgs(CREATE_INPUT);
  assert.deepEqual(args.slice(0, 3), ['release', 'create', 'mobile-v1.0.0']);
  assert.deepEqual(args.slice(3, 5), CREATE_INPUT.files);
});

test('passes the target and title, and never marks the Release latest', () => {
  const args = releaseCreateArgs(CREATE_INPUT);
  assert.equal(args[args.indexOf('--target') + 1], HEAD);
  assert.equal(args[args.indexOf('--title') + 1], CREATE_INPUT.title);
  assert.ok(args.includes('--latest=false'));
  assert.ok(!args.includes('--latest'));
});

// ------------------------------------------------ download page consistency

test('builds the tag and APK name the download page links to', () => {
  const source = readFileSync(resolve(DOWNLOAD_PAGE_VERSION_FILE), 'utf8');
  assert.equal(mobileReleaseTag('1.0.0'), 'mobile-v1.0.0');
  assert.equal(releaseApkName('1.0.0'), 'myorganiser-1.0.0.apk');
  assert.ok(source.includes('`mobile-v${version}`'));
  assert.ok(source.includes('`myorganiser-${version}.apk`'));
});

test('names the checksum file the way the download page links to it', () => {
  const source = readFileSync(resolve(DOWNLOAD_PAGE_VERSION_FILE), 'utf8');
  assert.ok(source.includes('${apk}.sha256`'), 'page links <apk>.sha256');
  assert.equal(
    checksumLine('ab'.repeat(32), releaseApkName('1.0.0')),
    `${'ab'.repeat(32)}  myorganiser-1.0.0.apk\n`,
  );
});

// ------------------------------------------------------- web release filter

/** Glob to RegExp for a tag filter: `*` matches within one path segment, anchored. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split('*')
    .map((part: string) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('[^/]*')}$`);
}

test('the web Release workflow does not start for a mobile-v tag', () => {
  const workflow = readFileSync(
    resolve('.github/workflows/publish-github-release.yml'),
    'utf8',
  );
  const pushTags = workflow.match(
    /^on:\n {2}push:\n {4}tags:\n((?: {6}- '[^']*'\n)+)/m,
  );
  assert.ok(pushTags, 'the workflow declares push tag filters');
  const globs = [...pushTags[1].matchAll(/- '([^']+)'/g)].map((m) => m[1]);
  assert.ok(globs.length > 0, 'at least one push tag filter is read');

  const triggers = (tag: string): boolean =>
    globs.some((glob) => globToRegExp(glob).test(tag));
  assert.equal(triggers('v1.0.0'), true);
  assert.equal(triggers('mobile-v1.0.0'), false);
});

test("the production dispatcher's job condition requires a release/v branch create", () => {
  // Text check: the job's `if:` must admit only a branch create under release/v.
  const workflow = readFileSync(
    resolve('.github/workflows/dispatch-production-deploy.yml'),
    'utf8',
  );
  assert.match(workflow, /^ {2}create:$/m, 'the workflow listens for create');
  const condition = workflow.match(/^ {4}if: (.*)$/m)?.[1];
  assert.ok(condition, 'the dispatch job declares an if: condition');
  assert.ok(
    condition.includes("github.event.ref_type == 'branch'"),
    'the create event must be a branch',
  );
  assert.ok(
    condition.includes("startsWith(github.event.ref, 'release/v')"),
    'the create event must name a release/v branch',
  );
});
