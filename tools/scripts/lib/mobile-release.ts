/**
 * Publishing a Mobile Release (CONTEXT.md, ADR 0127): a signed APK and its
 * SHA-256 checksum on a GitHub Release tagged `mobile-vX.Y.Z`, not marked
 * latest, so the web app's `vX.Y.Z` Release keeps that place.
 *
 * Every effect — reading the APK, `apksigner`, `aapt2`, git, `gh`, the file
 * system — is handed in, so the contract suite drives every refusal with the
 * GitHub call mocked. `tools/scripts/publish-mobile-release.ts` is the wiring.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Where `assembleRelease` leaves the signed APK. */
export const RELEASE_APK_PATH =
  'apps/mobile/android/app/build/outputs/apk/release/app-release.apk';

/** Where the published files are staged, named as they are attached. */
export const RELEASE_OUT_DIR = 'dist/mobile-release';

/** The one committed value the download page builds its links from. */
export const DOWNLOAD_PAGE_VERSION_FILE =
  'libs/web/pages/download/src/lib/mobileRelease.ts';

/**
 * SHA-256 of the certificate in the public React Native debug keystore
 * (apps/mobile/android/app/debug.keystore; `keytool -list -v`, password
 * `android`). The key is public, so anyone could sign an update to an APK
 * it signed: never a Mobile Release.
 */
export const DEBUG_CERTIFICATE_SHA256 =
  'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const mobileReleaseTag = (version: string): string =>
  `mobile-v${version}`;
export const releaseApkName = (version: string): string =>
  `myorganiser-${version}.apk`;

/** Thrown for every reason a publish is refused; `message` names it. */
export class MobileReleaseRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MobileReleaseRefusal';
  }
}

/** Every signer certificate SHA-256 `apksigner verify --print-certs` lists. */
export function parseSignerDigests(apksignerOutput: string): string[] {
  return [
    ...apksignerOutput.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/gi),
  ].map((match) => match[1].toLowerCase());
}

/** The `versionName` in `aapt2 dump badging` output, or `null`. */
export function parseVersionName(badging: string): string | null {
  return badging.match(/versionName='([^']*)'/)?.[1] ?? null;
}

/** The checksum file's line, in the format `sha256sum -c` reads. */
export function checksumLine(sha256: string, fileName: string): string {
  return `${sha256}  ${fileName}\n`;
}

export function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * `source` with its `CURRENT_MOBILE_RELEASE` declaration set to `version`.
 * Throws when the declaration is not there to rewrite, rather than leaving
 * the download page pointing at the previous Release unnoticed.
 */
export function withCurrentMobileRelease(
  source: string,
  version: string,
): string {
  const pattern =
    /export const CURRENT_MOBILE_RELEASE: string \| null = [^;]*;/;
  if (!pattern.test(source)) {
    throw new MobileReleaseRefusal(
      `${DOWNLOAD_PAGE_VERSION_FILE} has no CURRENT_MOBILE_RELEASE declaration to update.`,
    );
  }
  return source.replace(
    pattern,
    `export const CURRENT_MOBILE_RELEASE: string | null = '${version}';`,
  );
}

export interface MobileReleaseCreateArgs {
  tag: string;
  target: string;
  title: string;
  notes: string;
  files: string[];
}

export interface MobileReleaseDeps {
  exists(path: string): boolean;
  printCertificates(apkPath: string): string;
  dumpBadging(apkPath: string): string;
  tagExists(tag: string): boolean;
  headCommit(): string;
  readFile(path: string): string;
  makeDir(dir: string): void;
  copyFile(src: string, dest: string): void;
  sha256(path: string): string;
  writeFile(path: string, contents: string): void;
  createRelease(release: MobileReleaseCreateArgs): unknown;
}

export interface PublishedMobileRelease {
  tag: string;
  target: string;
  sha256: string;
  files: string[];
}

/**
 * Checks a built APK and, when it may be published, publishes it.
 *
 * Refuses, in this order, each with a `MobileReleaseRefusal` naming the
 * problem: a version that is not `X.Y.Z`; no APK at `apkPath`; an APK signed
 * with the public debug key, or not signed at all; an APK whose `versionName`
 * is not `version`; a `mobile-vX.Y.Z` tag that already exists, locally or on
 * the remote; a commit to tag that is not on the remote (`headCommit`
 * refuses); and a download page version file with no declaration to update.
 * Nothing is written or sent before every check has passed.
 *
 * Then: copies the APK to `outDir` as `myorganiser-X.Y.Z.apk`, writes its
 * `.sha256` beside it, creates the tag and its GitHub Release at `target`
 * with both files attached and `latest` false, and sets the download page's
 * version. Returns what it published.
 */
export function publishMobileRelease(
  {
    version,
    apkPath = RELEASE_APK_PATH,
    outDir = RELEASE_OUT_DIR,
  }: { version?: string; apkPath?: string; outDir?: string },
  deps: MobileReleaseDeps,
): PublishedMobileRelease {
  if (!VERSION_PATTERN.test(version ?? '')) {
    throw new MobileReleaseRefusal(
      `"${version ?? ''}" is not a Mobile Release version. Pass X.Y.Z, e.g. --version 1.0.0.`,
    );
  }
  // The pattern test above already refused an empty or missing version.
  version = version ?? '';
  if (!deps.exists(apkPath)) {
    throw new MobileReleaseRefusal(
      `No APK at ${apkPath}. Build it first: cd apps/mobile/android && ./gradlew assembleRelease.`,
    );
  }

  const digests = parseSignerDigests(deps.printCertificates(apkPath));
  if (digests.length === 0) {
    throw new MobileReleaseRefusal(
      `${apkPath} is not signed. Build the release with the MYORGANISER_RELEASE_* signing properties set.`,
    );
  }
  if (digests.includes(DEBUG_CERTIFICATE_SHA256)) {
    throw new MobileReleaseRefusal(
      `${apkPath} is signed with the public debug key, which anyone can use. Build the release with the MYORGANISER_RELEASE_* signing properties set.`,
    );
  }

  const built = parseVersionName(deps.dumpBadging(apkPath));
  if (built !== version) {
    throw new MobileReleaseRefusal(
      `${apkPath} is version ${built ?? '(unknown)'}, not ${version}. Set versionName (Android) and MARKETING_VERSION (iOS) to ${version}, rebuild, and run this again.`,
    );
  }

  const tag = mobileReleaseTag(version);
  if (deps.tagExists(tag)) {
    throw new MobileReleaseRefusal(
      `Tag ${tag} already exists. A published Mobile Release is never replaced; bump the version and build again.`,
    );
  }

  const target = deps.headCommit();
  // Read and rewritten now, so a page file that cannot take the new version
  // refuses here rather than after the Release is on GitHub.
  const pageSource = withCurrentMobileRelease(
    deps.readFile(DOWNLOAD_PAGE_VERSION_FILE),
    version,
  );

  const apkName = releaseApkName(version);
  const apkOut = `${outDir}/${apkName}`;
  const checksumOut = `${apkOut}.sha256`;
  deps.makeDir(outDir);
  deps.copyFile(apkPath, apkOut);
  const sha256 = deps.sha256(apkOut);
  deps.writeFile(checksumOut, checksumLine(sha256, apkName));

  deps.createRelease({
    tag,
    target,
    title: `MyOrganiser ${version} for Android`,
    notes: releaseNotes(version, apkName, sha256),
    files: [apkOut, checksumOut],
  });

  deps.writeFile(DOWNLOAD_PAGE_VERSION_FILE, pageSource);

  return { tag, target, sha256, files: [apkOut, checksumOut] };
}

function releaseNotes(
  version: string,
  apkName: string,
  sha256: string,
): string {
  return [
    `MyOrganiser ${version} for Android: a signed APK to install directly.`,
    '',
    'https://myorganiser.app/download names this version from the next web',
    'Release on, and says how to install it.',
    '',
    `SHA-256 (${apkName}): ${sha256}`,
  ].join('\n');
}

/** The `gh release create` arguments for `createRelease`. Never `--latest`. */
export function releaseCreateArgs({
  tag,
  target,
  title,
  notes,
  files,
}: MobileReleaseCreateArgs): string[] {
  return [
    'release',
    'create',
    tag,
    ...files,
    '--target',
    target,
    '--title',
    title,
    '--notes',
    notes,
    '--latest=false',
  ];
}
