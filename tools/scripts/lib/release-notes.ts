/**
 * Pure helpers for release notes, CHANGELOG assembly, and the contents of the
 * release commit.
 *
 * Kept free of `fs` and `git` so the assembly rules are unit-testable.
 * `tools/scripts/release.mjs` owns all side effects.
 */

export const CHANGELOG_TITLE = '# Changelog';

export const DEFAULT_NOTES_FILE = 'RELEASE_NOTES.md';

export interface NotesPlan {
  mode?: 'authored' | 'generated' | 'none';
  notesFile?: string | null;
  notesFrom?: string | null;
  error?: string;
}

export interface ResolveNotesPlanInput {
  notesFrom?: string | null;
  notesFile?: string | null;
  skipNotes?: boolean;
}

/**
 * Decide where release notes come from and where they are written.
 *
 * Three modes:
 * - `authored`  -- prose supplied by `--notes-from`, written verbatim.
 * - `generated` -- assembled from the commit range (the default).
 * - `none`      -- `--no-notes`; neither the notes file nor the CHANGELOG
 *                  entry is touched.
 *
 * The CHANGELOG entry stays generated in every mode. Authored prose is the
 * GitHub Release body, which `publish-github-release.yml` reads from the notes
 * file at the tagged commit; the CHANGELOG remains a uniform commit log.
 */
export function resolveNotesPlan({
  notesFrom,
  notesFile,
  skipNotes,
}: ResolveNotesPlanInput = {}): NotesPlan {
  const from = notesFrom || null;
  const file = notesFile || null;

  if (skipNotes && from) {
    return {
      error:
        '--no-notes cannot be combined with --notes-from. Drop one: --no-notes skips notes entirely, --notes-from supplies them.',
    };
  }

  if (skipNotes) {
    return { mode: 'none', notesFile: null, notesFrom: null };
  }

  if (from) {
    // Authored prose has to land somewhere, so default the destination
    // rather than silently reading a file and discarding it.
    return {
      mode: 'authored',
      notesFile: file || DEFAULT_NOTES_FILE,
      notesFrom: from,
    };
  }

  return { mode: 'generated', notesFile: file, notesFrom: null };
}

/**
 * Everything `yarn openapi:sync` writes that carries the package version: the
 * backend's swagger output, the synced spec, and the generated API client.
 *
 * The pre-commit `openapi:artifacts` gate refuses a commit where these
 * disagree with package.json, so the release commit that bumps the version
 * must carry them too. Directories rather than files because the sync owns
 * what it writes; `cut` starts from a clean tree, so nothing else is swept in.
 */
export const OPENAPI_SYNC_OUTPUTS = [
  'apps/backend/src/swagger',
  'libs/api-specs/src',
  'libs/app-api-client/src',
];

/** Paths staged into the `chore(release): vX.Y.Z` commit. */
export function releaseCommitPaths({
  notesFile,
}: { notesFile?: string | null } = {}): string[] {
  return [
    'package.json',
    'CHANGELOG.md',
    ...(notesFile ? [notesFile] : []),
    ...OPENAPI_SYNC_OUTPUTS,
  ];
}

/**
 * What to run after `cut` stops between creating the release branch and
 * committing, which leaves that branch checked out with uncommitted changes:
 * unstaged if the sync or the staging failed, staged if the leftover check or
 * the commit stopped it (the leftover check also leaves the drift unstaged).
 *
 * `cut` starts from a clean tree, so everything left behind is its own and
 * safe to discard. It prints the steps rather than running them: they discard
 * files, and that stays the operator's decision.
 *
 * @param releaseBranch e.g. `release/v1.2.3`
 */
export function abandonedCutSteps(releaseBranch: string): string {
  return [
    'Nothing was committed or pushed. To retry from a clean main:',
    '  git checkout -f main',
    `  git branch -D ${releaseBranch}`,
    'then remove anything `git status` still lists, and cut again.',
  ].join('\n');
}

/**
 * Paths `git status --porcelain` (v1) reports as changed but not staged,
 * untracked ones included.
 *
 * After staging the release commit this must be empty: anything left over is
 * something the release commit would not carry, and `tag` refuses a dirty
 * tree. Takes the raw output -- a trimmed first line loses its leading
 * status column and reads as staged.
 */
export function unstagedPaths(porcelain: string): string[] {
  return String(porcelain || '')
    .split(/\r?\n/)
    .filter((line) => line.length > 3)
    .filter((line) => line.startsWith('??') || line[1] !== ' ')
    .map((line) => line.slice(3));
}

/**
 * Matches a CHANGELOG version heading: `## v1.2.3 - 2026-01-01`.
 *
 * Only version headings delimit a section. Generated entry bodies contain
 * their own `## Changes since vX.Y.Z` sub-heading at the same level, and
 * treating those as boundaries is what previously truncated a replacement
 * to the heading line and left the old body behind.
 */
const VERSION_HEADING_RE = /^## v\d+\.\d+\.\d+\b/;

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CommitClassification {
  type: string;
  scope: string | null;
  description: string;
  breaking: boolean;
}

export function classifyCommit(
  subject: string | undefined,
  body: string | undefined,
): CommitClassification {
  const s = String(subject || '').trim();
  const b = String(body || '');

  const hasBreaking = /BREAKING CHANGE:/i.test(b);
  const m = /^([a-zA-Z]+)(\([^)]*\))?(!)?:\s+(.+)$/.exec(s);

  if (!m) {
    return {
      type: 'other',
      scope: null,
      description: s || '(no subject)',
      breaking: hasBreaking,
    };
  }

  const type = m[1].toLowerCase();
  const scope = m[2] ? m[2].slice(1, -1) : null;
  const bang = Boolean(m[3]);
  const description = m[4];

  return { type, scope, description, breaking: bang || hasBreaking };
}

/**
 * Insert or replace the `## <versionTag>` section of a CHANGELOG.
 *
 * A section runs from its version heading until the next version heading, or
 * to end of input when it is the last section. Replacing an existing section
 * is idempotent: running a release step twice yields the same file.
 *
 * @param existingContent Current CHANGELOG.md contents (may be empty).
 * @param params `entry` is the full section including its own
 *   `## <versionTag> - <date>` heading.
 * @returns The updated CHANGELOG contents.
 */
export function upsertChangelogSection(
  existingContent: string,
  { versionTag, entry }: { versionTag: string; entry: string },
): string {
  if (!versionTag) throw new TypeError('versionTag is required');
  if (!entry) throw new TypeError('entry is required');

  const entryLines = entry.trimEnd().split(/\r?\n/);
  const sectionHeadingRe = new RegExp(`^## ${escapeRegExp(versionTag)}\\b`);

  let content = String(existingContent || '').trim();
  if (!content) content = CHANGELOG_TITLE;
  if (!content.startsWith(CHANGELOG_TITLE)) {
    content = `${CHANGELOG_TITLE}\n\n${content}`;
  }

  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => sectionHeadingRe.test(line));

  if (start !== -1) {
    // Replace through to the next version heading, or to end of file.
    let end = start + 1;
    while (end < lines.length && !VERSION_HEADING_RE.test(lines[end])) {
      end += 1;
    }

    const before = lines.slice(0, start);
    const after = lines.slice(end);
    const next =
      after.length > 0
        ? [...before, ...entryLines, '', ...after]
        : [...before, ...entryLines];

    return `${next.join('\n').trimEnd()}\n`;
  }

  // No section for this version yet: insert above the newest existing one.
  const firstVersionIdx = lines.findIndex((line) =>
    VERSION_HEADING_RE.test(line),
  );

  if (firstVersionIdx === -1) {
    return `${[...lines, '', ...entryLines].join('\n').trim()}\n`;
  }

  const head = lines.slice(0, firstVersionIdx);
  const rest = lines.slice(firstVersionIdx);

  while (head.length > 0 && head[head.length - 1].trim() === '') head.pop();

  return `${[...head, '', ...entryLines, '', ...rest].join('\n').trimEnd()}\n`;
}
