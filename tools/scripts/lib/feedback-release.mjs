/**
 * Release marking from the Production deploy (ADR 0133, issue #1215): after a
 * Release is live, the issues its commits close are sent to the backend, which
 * marks every Planned Feedback Report on them Fixed or Shipped.
 *
 * The parsing here is pure, so the contract suite drives it without git.
 * `tools/scripts/mark-feedback-release.mjs` is the wiring.
 */

const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The backend's cap (MAX_ISSUE_NUMBERS in apps/backend/src/services/
 * FeedbackReleaseService.ts). Checked here so an oversize Release fails with
 * the count rather than a bare 400; the backend stays the authority.
 */
export const MAX_ISSUE_NUMBERS = 500;

export const MARK_RELEASE_PATH = '/api/v1/feedback/releases/mark';

/**
 * A GitHub closing keyword, then `#N` in this repository. The lookbehind keeps
 * `prefix #8` or `unfixed #9` from counting, and the `#` must not follow a
 * repository name, so `Closes owner/repo#7` is left to that repository.
 */
const CLOSING_REFERENCE =
  /(?<![\w/-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;

function parseVersion(tag) {
  const match = RELEASE_TAG.exec(tag);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** The Release tag a `release/vX.Y.Z` branch ships, e.g. `v1.4.0`. */
export function releaseTagFromRef(ref) {
  const tag = String(ref ?? '').replace(/^refs\/heads\//, '');
  const match = /^release\/(v.+)$/.exec(tag);
  if (!match || !parseVersion(match[1])) {
    throw new Error(`Not a release branch: "${ref}". Expected release/vX.Y.Z.`);
  }
  return match[1];
}

/**
 * The highest `vX.Y.Z` tag below `releaseTag`, or null when there is none.
 * The release tag itself never counts, so a re-run after `release:tag` still
 * covers the same range.
 */
export function previousReleaseTag(tags, releaseTag) {
  const release = parseVersion(releaseTag);
  if (!release) return null;
  let best = null;
  for (const tag of tags) {
    const version = parseVersion(tag);
    if (!version || compareVersions(version, release) >= 0) continue;
    if (!best || compareVersions(version, best.version) > 0) {
      best = { tag, version };
    }
  }
  return best?.tag ?? null;
}

/** Every issue these commit messages close, deduplicated and ascending. */
export function closingIssueNumbers(messages) {
  const issues = new Set();
  for (const message of messages) {
    for (const match of String(message).matchAll(CLOSING_REFERENCE)) {
      const issue = Number(match[1]);
      if (issue > 0) issues.add(issue);
    }
  }
  return [...issues].sort((a, b) => a - b);
}

/**
 * Sends the issues this Release closes to the backend. Refuses before any git
 * or network call when the ref or the credentials are missing, and skips the
 * call entirely when the Release closes nothing. A failure leaves the reports
 * Planned (ADR 0133), so the job is safe to re-run; no message names the secret.
 */
export async function markFeedbackRelease({
  releaseRef,
  apiOrigin,
  secret,
  git,
  fetch,
}) {
  const releaseTag = releaseTagFromRef(releaseRef);
  if (!apiOrigin) throw new Error('API_ORIGIN is not set.');
  if (!secret) throw new Error('FEEDBACK_RELEASE_SECRET is not set.');

  const previous = previousReleaseTag(git.tags(), releaseTag);
  // The first Release has no earlier tag, so its range is all of history;
  // past the 500 cap that refuses rather than marking a partial list.
  const range = previous ? `${previous}..HEAD` : 'HEAD';
  const issueNumbers = closingIssueNumbers(git.messages(range));

  if (issueNumbers.length === 0) {
    return { releaseTag, issueNumbers, counts: null, skipped: true };
  }
  if (issueNumbers.length > MAX_ISSUE_NUMBERS) {
    throw new Error(
      `${releaseTag} closes ${issueNumbers.length} issues; the backend accepts at most ${MAX_ISSUE_NUMBERS}.`,
    );
  }

  const url = `${String(apiOrigin).replace(/\/+$/, '')}${MARK_RELEASE_PATH}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Deploy-Secret': secret,
      },
      body: JSON.stringify({ releaseTag, issueNumbers }),
    });
  } catch (error) {
    throw new Error(`Could not reach ${url}: ${error?.message ?? error}`);
  }

  if (!response.ok) {
    throw new Error(
      `Release marking for ${releaseTag} failed: HTTP ${response.status} from ${url}.`,
    );
  }

  return {
    releaseTag,
    issueNumbers,
    counts: await response.json(),
    skipped: false,
  };
}
