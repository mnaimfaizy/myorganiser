// The current Mobile Release: the one value the download page builds its
// links from. Product Surface (ADR 0086) — public by nature, so committed.
//
// `yarn mobile:release:publish` rewrites the `CURRENT_MOBILE_RELEASE` line
// after it publishes, so the page moves with the next web Release. Keep the
// declaration on one line in this shape; the command finds it by its name.

/** The newest Mobile Release, `X.Y.Z`, or `null` before the first one. */
export const CURRENT_MOBILE_RELEASE: string | null = '1.0.0';

const REPOSITORY_URL = 'https://github.com/mnaimfaizy/myorganiser';

/** Where a Mobile Release's files live, built from its version. */
export interface MobileReleaseLinks {
  version: string;
  /** The GitHub Release page. */
  releaseUrl: string;
  /** The signed APK. */
  apkUrl: string;
  /** The APK's SHA-256 checksum file. */
  checksumUrl: string;
}

/**
 * The links for Mobile Release `version`. The asset names are the ones the
 * publish command attaches (tools/scripts/lib/mobile-release.mjs).
 */
export function mobileReleaseLinks(version: string): MobileReleaseLinks {
  const tag = `mobile-v${version}`;
  const apk = `myorganiser-${version}.apk`;
  const download = `${REPOSITORY_URL}/releases/download/${tag}`;
  return {
    version,
    releaseUrl: `${REPOSITORY_URL}/releases/tag/${tag}`,
    apkUrl: `${download}/${apk}`,
    checksumUrl: `${download}/${apk}.sha256`,
  };
}
