import { execSync, type ExecSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { errorMessage } from './lib/error-message.ts';
import { GhJsonError, ghJson } from './lib/gh.ts';
import {
  AbandonedCutError,
  assertNothingLeftUnstaged,
  runOrAbandonCut,
} from './lib/release-cut.ts';
import {
  classifyCommit,
  releaseCommitPaths,
  resolveNotesPlan,
  upsertChangelogSection,
} from './lib/release-notes.ts';
import {
  type ApiJob,
  type ApiRun,
  evaluateStagingHostApply,
  normalizeJobs,
} from './lib/staging-host-apply-guard.ts';

function assertNodeVersion(): void {
  const major = Number(String(process.versions.node).split('.')[0]);
  if (!Number.isFinite(major) || major < 22) {
    console.error(
      `Node.js v22+ is required to run this script. Current: ${process.versions.node}`,
    );
    process.exit(1);
  }
}

function run(command: string, options: ExecSyncOptions = {}): string {
  return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    .toString('utf8')
    .trim();
}

function runInherit(command: string): void {
  execSync(command, { stdio: 'inherit' });
}

function quoteShellArg(value: string): string {
  const v = String(value);
  // Minimal, cross-platform-friendly quoting for paths/args.
  // Wrap in double quotes and escape internal double quotes.
  return `"${v.replaceAll('"', '\\"')}"`;
}

function ensureParentDirExists(
  filePath: string,
  { dryRun }: { dryRun?: boolean },
): void {
  const dir = path.dirname(filePath);
  if (!dir || dir === '.' || dir === filePath) return;

  if (dryRun) return;
  fs.mkdirSync(dir, { recursive: true });
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

interface ReleaseArgs {
  _: string[];
  help?: boolean;
  push?: boolean;
  dryRun?: boolean;
  skipVersionBump?: boolean;
  skipNotes?: boolean;
  notesFile?: string | null;
  notesFrom?: string | null;
  version?: string;
}

function parseArgs(argv: string[]): ReleaseArgs {
  const args: ReleaseArgs = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--push') {
      args.push = true;
      continue;
    }

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (token === '--no-version-bump' || token === '--skip-version-bump') {
      args.skipVersionBump = true;
      continue;
    }

    if (token === '--no-notes' || token === '--skip-notes') {
      args.skipNotes = true;
      continue;
    }

    if (token.startsWith('--notes-file=')) {
      args.notesFile = token.slice('--notes-file='.length);
      continue;
    }

    if (token === '--notes-file') {
      const next = argv[i + 1];
      // Allow "--notes-file" without a value to default to a rolling file.
      if (!next || next.startsWith('-')) {
        args.notesFile = 'RELEASE_NOTES.md';
      } else {
        args.notesFile = next;
        i += 1;
      }
      continue;
    }

    if (token.startsWith('--notes-from=')) {
      args.notesFrom = token.slice('--notes-from='.length);
      continue;
    }

    if (token === '--notes-from') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        die('Missing value for --notes-from option.');
      }
      args.notesFrom = next;
      i += 1;
      continue;
    }

    if (token.startsWith('--version=')) {
      args.version = token.slice('--version='.length);
      continue;
    }

    if (token === '--version') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        die('Missing value for --version option.');
      }
      args.version = next;
      i += 1;
      continue;
    }

    args._.push(token);
  }

  return args;
}

function normalizeVersion(input: string | undefined): string | undefined {
  if (!input) return undefined;

  const v = String(input).trim();
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!match) {
    die(
      `Invalid version: "${input}". Expected semver like v1.2.3 or 1.2.3 (no prerelease).`,
    );
  }

  return `v${match[1]}.${match[2]}.${match[3]}`;
}

function toPackageJsonVersion(tagVersion: string): string {
  // v1.2.3 -> 1.2.3
  return String(tagVersion).startsWith('v')
    ? String(tagVersion).slice(1)
    : String(tagVersion);
}

/** The one shape this script reads or writes on the root `package.json`. */
interface RootPackageJson {
  version?: string;
  [key: string]: unknown;
}

function readRootPackageJsonVersion(): string {
  const json: unknown = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (!json || typeof json !== 'object') {
    die('Failed to parse package.json');
  }
  return (json as RootPackageJson).version ?? '';
}

function assertPackageJsonVersionMatches(expectedVersion: string): void {
  const actual = readRootPackageJsonVersion();
  if (actual !== expectedVersion) {
    die(
      `package.json version is ${actual}, expected ${expectedVersion}. ` +
        'Run `release:cut` first, or check out the release branch.',
    );
  }
}

function updateRootPackageJsonVersion(
  nextVersion: string,
  { dryRun }: { dryRun?: boolean },
): boolean {
  const filePath = 'package.json';
  const content = fs.readFileSync(filePath, 'utf8');
  const json: unknown = JSON.parse(content);

  if (!json || typeof json !== 'object') {
    die('Failed to parse package.json');
  }
  const pkg = json as RootPackageJson;

  if (pkg.version === nextVersion) {
    return false;
  }

  pkg.version = nextVersion;

  const nextContent = `${JSON.stringify(pkg, null, 2)}\n`;
  if (dryRun) {
    console.log(`[dry-run] update ${filePath} version -> ${nextVersion}`);
    return true;
  }

  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
}

function getCurrentBranch(): string {
  return run('git rev-parse --abbrev-ref HEAD');
}

function assertCleanTree(): void {
  const porcelain = run('git status --porcelain');
  if (porcelain.length > 0) {
    die(
      'Working tree is not clean. Commit/stash your changes before releasing.',
    );
  }
}

function assertOnBranch(expected: string): void {
  const current = getCurrentBranch();
  if (current !== expected) {
    die(`Expected to be on branch "${expected}", but you are on "${current}".`);
  }
}

function assertUpToDateWithOrigin(branch: string): void {
  runInherit('git fetch origin --prune');

  const local = run(`git rev-parse ${branch}`);
  const remote = run(`git rev-parse origin/${branch}`);

  if (local !== remote) {
    die(
      `Local ${branch} is not up to date with origin/${branch}. Run: git pull --ff-only`,
    );
  }
}

// Recent `Deploy Staging` runs to read, newest first, from every ref: a run
// from any branch writes the same APP_ROOT, so filtering one out could only
// allow a Cut. Those runs queue one at a time, so an upload outside the window
// cannot be Staging's latest; missing one can only refuse a Cut.
const STAGING_RUNS_TO_READ = 20;

function ghApi(endpoint: string): unknown {
  try {
    return ghJson(['api', endpoint]);
  } catch (error) {
    if (error instanceof GhJsonError) {
      die(
        `Refusing to Cut: \`gh api ${endpoint}\` did not return JSON:\n${error.stdout.slice(0, 500)}`,
      );
    }
    const stderr = (error as { stderr?: unknown } | null)?.stderr;
    die(
      `Refusing to Cut: could not read Staging deploy runs with \`gh api ${endpoint}\`. ` +
        'Install and authenticate the GitHub CLI (`gh auth login`).\n' +
        (typeof stderr === 'string' ? stderr.trim() : errorMessage(error)),
    );
  }
}

/** Workflow run envelope `gh api`'s `runs` listing carries, beyond what the guard reads. */
type WorkflowRun = ApiRun & { id: number };

// ADR 0056 (amendment 2026-09-14): Staging must hold the commit being cut,
// Host Applied. There is deliberately no flag to skip this.
function assertStagingHostApplied(cutSha: string): void {
  const { workflow_runs: runs } = ghApi(
    `repos/{owner}/{repo}/actions/workflows/deploy-staging.yml/runs?per_page=${STAGING_RUNS_TO_READ}`,
  ) as { workflow_runs: WorkflowRun[] };

  const jobs = runs.flatMap((stagingRun) =>
    normalizeJobs(
      stagingRun,
      (
        ghApi(
          `repos/{owner}/{repo}/actions/runs/${stagingRun.id}/jobs?per_page=100`,
        ) as { jobs: ApiJob[] }
      ).jobs,
    ),
  );

  const result = evaluateStagingHostApply({
    cutSha,
    jobs,
    runsRead: STAGING_RUNS_TO_READ,
  });
  if (!result.ok) die(result.reason);

  console.log(`Staging holds ${cutSha.slice(0, 7)}, Host Applied.`);
}

function branchExists(branchName: string): boolean {
  try {
    run(`git rev-parse --verify ${branchName}`);
    return true;
  } catch {
    return false;
  }
}

function tagExists(tagName: string): boolean {
  try {
    run(`git rev-parse --verify refs/tags/${tagName}`);
    return true;
  } catch {
    return false;
  }
}

interface SemverTag {
  major: number;
  minor: number;
  patch: number;
}

function parseSemverTag(tag: string): SemverTag | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(tag));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function getLatestReachableSemverTag({
  excludeTag,
}: { excludeTag?: string } = {}): string | null {
  // Find the most recent semver tag that is reachable from HEAD.
  // Prefer semantic sort (highest version) then verify ancestry.
  // This avoids relying on GitHub releases or fragile shell quoting.
  const raw = run('git tag -l "v[0-9]*.[0-9]*.[0-9]*" --sort=-v:refname');
  if (!raw) return null;

  const tags = raw
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => parseSemverTag(t) !== null)
    .filter((t) => !excludeTag || t !== excludeTag);

  for (const t of tags) {
    try {
      run(`git merge-base --is-ancestor ${t} HEAD`);
      return t;
    } catch {
      // Not reachable from current HEAD; skip.
    }
  }

  return null;
}

function normalizeNotesFilePath(
  notesFile: string | null | undefined,
): string | null | undefined {
  if (!notesFile) return notesFile;

  // Discourage accumulating versioned release notes files.
  // Prefer a single rolling file since CHANGELOG.md is the source of truth.
  if (/^release-notes-v\d+\.\d+\.\d+\.md$/i.test(path.basename(notesFile))) {
    return 'RELEASE_NOTES.md';
  }

  return notesFile;
}

function getGitHubRepoSlugFromRemote(): string | null {
  try {
    const url = run('git config --get remote.origin.url');
    if (!url) return null;

    // https://github.com/owner/repo.git
    const httpsMatch =
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;

    // git@github.com:owner/repo.git
    const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;

    return null;
  } catch {
    return null;
  }
}

function readAuthoredNotes(notesFrom: string, versionTag: string): string {
  if (!fs.existsSync(notesFrom)) {
    die(`--notes-from file not found: ${notesFrom}`);
  }

  const content = fs.readFileSync(notesFrom, 'utf8');
  if (!content.trim()) {
    die(`--notes-from file is empty: ${notesFrom}`);
  }

  // A stale draft for the previous version is the likely mistake here, and it
  // would ship as the GitHub Release body. Warn rather than block: notes that
  // never name the version are unusual but not wrong.
  if (!content.includes(versionTag)) {
    console.warn(
      `Warning: ${notesFrom} never mentions ${versionTag}. Check you are not passing a stale draft.`,
    );
  }

  return content.endsWith('\n') ? content : `${content}\n`;
}

function generateReleaseNotesMarkdown({
  versionTag,
  previousTag,
}: {
  versionTag: string;
  previousTag: string | null;
}): string {
  const slug = getGitHubRepoSlugFromRemote();
  const title = `# Release ${versionTag}`;
  const date = new Date().toISOString().slice(0, 10);

  let rangeLabel = 'Initial release';
  let compareUrl: string | null = null;

  if (previousTag) {
    rangeLabel = `Changes since ${previousTag}`;
    if (slug) {
      compareUrl = `https://github.com/${slug}/compare/${previousTag}...${versionTag}`;
    }
  }

  const logRange = previousTag ? `${previousTag}..HEAD` : 'HEAD';

  const raw = run(
    `git log --no-merges --pretty=format:%H%x1f%s%x1f%b%x1e ${logRange}`,
  );

  const entries = raw
    ? raw
        .split('\x1e')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
          const [hash, subject, body] = chunk.split('\x1f');
          return { hash, subject, body };
        })
    : [];

  const sections: Record<string, string[]> = {
    breaking: [],
    feat: [],
    fix: [],
    perf: [],
    docs: [],
    refactor: [],
    test: [],
    ci: [],
    chore: [],
    other: [],
  };

  for (const e of entries) {
    const c = classifyCommit(e.subject, e.body);
    const short = String(e.hash || '').slice(0, 7);
    const scope = c.scope ? `**${c.scope}**: ` : '';
    const line = `- ${scope}${c.description} (${short})`;

    if (c.breaking) {
      sections.breaking.push(line);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(sections, c.type)) {
      sections[c.type].push(line);
    } else {
      sections.other.push(line);
    }
  }

  const lines = [title, '', `Date: ${date}`, '', `## ${rangeLabel}`];

  if (compareUrl) {
    lines.push('', `Compare: ${compareUrl}`);
  }

  const addSection = (heading: string, arr: string[]): void => {
    if (!arr.length) return;
    lines.push('', `### ${heading}`, ...arr);
  };

  addSection('Breaking changes', sections.breaking);
  addSection('Features', sections.feat);
  addSection('Fixes', sections.fix);
  addSection('Performance', sections.perf);
  addSection('Documentation', sections.docs);
  addSection('Refactors', sections.refactor);
  addSection('Tests', sections.test);
  addSection('CI', sections.ci);
  addSection('Chores', sections.chore);
  addSection('Other changes', sections.other);

  if (!entries.length) {
    lines.push('', '_No changes detected in git log range._');
  }

  return `${lines.join('\n')}\n`;
}

function generateChangelogEntryMarkdown({
  versionTag,
  previousTag,
}: {
  versionTag: string;
  previousTag: string | null;
}): string {
  const fullNotes = generateReleaseNotesMarkdown({ versionTag, previousTag });

  // Convert "# Release vX.Y.Z" -> "## vX.Y.Z - YYYY-MM-DD" (Keep it simple)
  // Strip the first title line and reuse the remaining sections.
  const date = new Date().toISOString().slice(0, 10);
  const lines = fullNotes.split(/\r?\n/);
  const withoutTitle = lines.slice(1).join('\n').trim();
  return `## ${versionTag} - ${date}\n\n${withoutTitle}\n`;
}

function updateChangelogFile({
  versionTag,
  previousTag,
  dryRun,
}: {
  versionTag: string;
  previousTag: string | null;
  dryRun?: boolean;
}): boolean {
  const filePath = 'CHANGELOG.md';

  const entry = generateChangelogEntryMarkdown({
    versionTag,
    previousTag,
  }).trimEnd();

  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8')
    : '';

  const nextContent = upsertChangelogSection(existing, { versionTag, entry });

  if (dryRun) {
    console.log(`[dry-run] update ${filePath} for ${versionTag}`);
    return true;
  }

  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
}

function printHelp(): void {
  const HELP_TEXT = `Release helper (git automation)

Usage:
  node tools/scripts/release.ts cut --version v1.2.3 [--push] [--dry-run]
    [--notes-from <path>] [--notes-file <path>] [--no-notes] [--no-version-bump]
  node tools/scripts/release.ts tag --version v1.2.3 [--push] [--dry-run]

What it does:
  cut:
    - checks clean working tree
    - ensures you are on main and up-to-date with origin/main
    - creates release branch: release/<version> (e.g. release/v1.2.3)
    - updates root package.json version to X.Y.Z and commits it (default)
      - use --no-version-bump to skip
    - regenerates the OpenAPI spec and API client (yarn openapi:sync), which
      carry that version, into the same commit; refuses to commit if the
      sync changed anything the commit would not carry
    - optionally pushes the branch (with --push)
    - updates CHANGELOG.md with generated notes and commits it (default)
      - use --no-notes to skip
      - use --notes-file <path> to also write the notes to a file
    - prints release notes to stdout if --notes-file is NOT provided

    Release notes source:
      - default: assembled from the commit range
      - --notes-from <path>: use hand-written prose from <path> verbatim.
        Writes it to --notes-file (default RELEASE_NOTES.md) inside the same
        release commit, so authored notes cost no extra commit. Point it at a
        file outside the repo or a gitignored one -- cut requires a clean tree.
        CHANGELOG.md stays generated in both cases; the authored prose is the
        GitHub Release body, which publish-github-release.yml reads from the
        notes file at the tagged commit.
      - --notes-from cannot be combined with --no-notes.

  tag:
    - checks clean working tree
    - verifies you are on the release branch (release/<version>)
    - verifies local release branch is in sync with origin
    - verifies root package.json version already matches X.Y.Z
    - creates an annotated tag vX.Y.Z (if not exists)
    - optionally pushes the tag (with --push)

    tag never writes files or creates commits. Run it only after the
    production deploy succeeds: the tag records which commit went live, so
    it must name the exact SHA that CI verified and a reviewer approved.
    --no-notes, --notes-file, and --no-version-bump apply to cut only.

Notes:
  - This script does NOT trigger GitHub Actions for you.
  - Production deploys require required-reviewer approval on the 'production'
    GitHub Environment. See docs/adr/0028-*.md.`;

  console.log(`\n${HELP_TEXT}`);
}

assertNodeVersion();

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const command = args._[0];
const version = normalizeVersion(args.version);

if (!command || (command !== 'cut' && command !== 'tag')) {
  printHelp();
  die('Missing command. Use: cut or tag');
}

if (!version) {
  die('Missing --version. Example: --version v1.2.3');
}

const releaseBranch = `release/${version}`;
const packageJsonVersion = toPackageJsonVersion(version);

args.notesFile = normalizeNotesFilePath(args.notesFile);

const notesPlan = resolveNotesPlan({
  notesFrom: args.notesFrom,
  notesFile: args.notesFile,
  skipNotes: args.skipNotes,
});

if (notesPlan.error) {
  die(notesPlan.error);
}

if (command === 'tag' && (args.notesFrom || args.notesFile || args.skipNotes)) {
  console.warn(
    'Note: --notes-from, --notes-file, and --no-notes apply to `cut` only. `tag` never writes files.',
  );
}

const shouldGenerateNotes = notesPlan.mode !== 'none';
args.notesFile = notesPlan.notesFile;

const previousTag = shouldGenerateNotes
  ? getLatestReachableSemverTag({ excludeTag: version })
  : null;

assertCleanTree();

if (command === 'cut') {
  assertOnBranch('main');
  assertUpToDateWithOrigin('main');
  assertStagingHostApplied(run('git rev-parse main'));

  if (branchExists(releaseBranch)) {
    die(`Branch already exists: ${releaseBranch}`);
  }

  const createBranchCmd = `git checkout -b ${releaseBranch}`;
  if (args.dryRun) {
    console.log(`[dry-run] ${createBranchCmd}`);
  } else {
    runInherit(createBranchCmd);
  }

  let didChangeFiles = false;

  let notes: string | null = null;
  if (shouldGenerateNotes) {
    notes =
      notesPlan.mode === 'authored'
        ? readAuthoredNotes(notesPlan.notesFrom!, version)
        : generateReleaseNotesMarkdown({
            versionTag: version,
            previousTag,
          });

    if (args.notesFile) {
      ensureParentDirExists(args.notesFile, { dryRun: args.dryRun });
      if (args.dryRun) {
        const source =
          notesPlan.mode === 'authored'
            ? `${notesPlan.notesFrom} (authored)`
            : 'generated';
        console.log(
          `[dry-run] write release notes -> ${args.notesFile} (from ${source})`,
        );
      } else {
        fs.writeFileSync(args.notesFile, notes, 'utf8');
      }
      didChangeFiles = true;
    }
  }

  if (!args.skipVersionBump) {
    didChangeFiles =
      updateRootPackageJsonVersion(packageJsonVersion, {
        dryRun: args.dryRun,
      }) || didChangeFiles;
  }

  if (shouldGenerateNotes) {
    didChangeFiles =
      updateChangelogFile({
        versionTag: version,
        previousTag,
        dryRun: args.dryRun,
      }) || didChangeFiles;
  }

  if (didChangeFiles) {
    // The OpenAPI spec and generated client carry package.json's version, and
    // the pre-commit `openapi:artifacts` gate refuses a commit where they
    // differ. Without this the cut died at the commit (v1.0.0, v1.1.0).
    const syncCmd = 'corepack yarn openapi:sync';
    const addCmd = `git add ${releaseCommitPaths({ notesFile: args.notesFile })
      .map(quoteShellArg)
      .join(' ')}`;
    const commitCmd = `git commit -m "chore(release): ${version}"`;

    if (args.dryRun) {
      console.log(`[dry-run] ${syncCmd}`);
      console.log(`[dry-run] ${addCmd}`);
      console.log(`[dry-run] ${commitCmd}`);
    } else {
      try {
        runOrAbandonCut(syncCmd, releaseBranch);
        runOrAbandonCut(addCmd, releaseBranch);
        assertNothingLeftUnstaged(releaseBranch);
        runOrAbandonCut(commitCmd, releaseBranch);
      } catch (error) {
        if (error instanceof AbandonedCutError) die(error.message);
        throw error;
      }
    }
  }

  if (args.push) {
    const pushCmd = `git push -u origin ${releaseBranch}`;
    if (args.dryRun) {
      console.log(`[dry-run] ${pushCmd}`);
    } else {
      runInherit(pushCmd);
    }
  } else {
    console.log(`Next: git push -u origin ${releaseBranch}`);
  }

  if (shouldGenerateNotes) {
    if (args.notesFile) {
      console.log(`\nRelease notes written to: ${args.notesFile}`);
    } else {
      console.log(`\n--- RELEASE NOTES (${version}) ---\n`);
      process.stdout.write(notes ?? '');
    }
  }

  console.log(`\nRelease branch ready: ${releaseBranch}`);
  console.log(
    'Next: run GitHub Actions → Deploy Production (manual) for this branch.',
  );
  process.exit(0);
}

// command === 'tag'
//
// Tagging is a receipt, not a build step: the tag records that this version
// reached production (ADR 0028). It must not write files or create commits.
// Notes, the version bump, and the CHANGELOG entry all belong to `cut` -- a
// commit created here would move the branch past the exact SHA that CI
// verified and a reviewer approved, so the tag would name a commit that was
// never deployed.
assertOnBranch(releaseBranch);
assertUpToDateWithOrigin(releaseBranch);
assertPackageJsonVersionMatches(packageJsonVersion);

if (tagExists(version)) {
  die(`Tag already exists: ${version}`);
}

const tagCmd = `git tag -a ${version} -m "Release ${version}"`;
if (args.dryRun) {
  console.log(`[dry-run] ${tagCmd}`);
} else {
  runInherit(tagCmd);
}

if (args.push) {
  const pushTagCmd = `git push origin ${version}`;
  if (args.dryRun) {
    console.log(`[dry-run] ${pushTagCmd}`);
  } else {
    runInherit(pushTagCmd);
  }
} else {
  console.log(`Next: git push origin ${version}`);
}
