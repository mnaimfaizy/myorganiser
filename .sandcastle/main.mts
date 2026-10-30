import { claudeCode, copilot, cursor, run } from '@ai-hero/sandcastle';
import { docker } from '@ai-hero/sandcastle/sandboxes/docker';
import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  MAX_QUOTA_WAITS,
  SLICE_DISPOSITIONS,
  formatWaitWindow,
  classifyRunFailure,
  decideWaitPolicy,
  tailLines,
  extractHandoff,
  HANDOFF_MARKER,
  PRIOR_RUN_KINDS,
  buildResumeBrief,
  decideSliceDisposition,
  isDiscardRequested,
  validateDiscardScope,
  withMaintainerNotes,
  withTriageBrief,
} from '../tools/scripts/lib/sandcastle-resume.ts';
import type { IssueComment } from '../tools/scripts/lib/issue-comments.ts';
import {
  extractMaintainerNotes,
  latestTriageBrief,
} from '../tools/scripts/lib/issue-comments.ts';
import {
  blockedBy,
  blocks,
  describeAssembly,
  describeBlockedSlices,
  findDependencyCycles,
  formatCycle,
  isCompleted,
  isSatisfiedAsDependency,
  selectPrdSlices,
  unfinishedDependencies,
} from '../tools/scripts/lib/sandcastle-slice-selection.ts';
import {
  parseSubagentTranscript,
  formatSubagentIndex,
  formatTokens,
} from '../tools/scripts/lib/sandcastle-subagent-trace.ts';
import {
  branchNameCarriesIssue,
  fixAttributionInstruction,
  prdBranchSlug,
  specAnchorMessage,
} from '../tools/scripts/lib/sandcastle-spec-anchor.ts';
import {
  LATEST_RELEASE_URL,
  claudeCodeLogLine,
  claudeCodePolicy,
  describeClaudeCodeMode,
  parseClaudeCodeVersion,
  parseReleaseVersion,
} from '../tools/scripts/lib/sandcastle-cli-version.ts';
import {
  COMPLETION_PROMISE,
  NEEDS_HUMAN_LABEL,
  OUTSTANDING_MARKER,
  formatHeldComment,
  formatStandaloneReadyComment,
  STANDALONE_HANDOFF_LABELS,
  judgeRunOutcome,
} from '../tools/scripts/lib/sandcastle-outcome.ts';
import {
  isCleanupOnlyFailure,
  repairOrphanedWorktree,
} from '../tools/scripts/lib/sandcastle-worktree-repair.ts';

const REPO = 'mnaimfaizy/myorganiser';
const SANDBOX_IMAGE = 'sandcastle:myorganiser';

dotenv.config({ path: join(process.cwd(), '.sandcastle', '.env') });

type AgentModelPolicy = {
  orchestrators: {
    sandcastle: {
      claudeByComplexity: {
        low: string;
        medium: string;
        high: string;
      };
      cursorDefault: string;
      copilotDefault: string;
    };
  };
};

const agentModelPolicy = JSON.parse(
  readFileSync(
    join(process.cwd(), 'tools', 'config', 'agent-model-policy.json'),
    'utf8',
  ),
) as AgentModelPolicy;
const sandcastleModels = agentModelPolicy.orchestrators.sandcastle;

// ─── Integration model (local-only) ───────────────────────────────────────────
// GitHub coupling is deliberately minimal: we READ the issue(s) and WRITE status
// labels + a completion comment back. That is all.
//
// Everything else is LOCAL:
//   • The feature branch `feat/<slug>` is created from origin/main and is NEVER
//     pushed. It lives only in this clone until you push it by hand.
//   • Slices run ONE BY ONE. Each branches off the CURRENT local feature head, so
//     a slice sees every previously-merged slice's work. The agent commits inside
//     its sandbox; the host fast-forwards the local feature branch onto the slice.
//   • No per-slice push, no per-slice PR, no `gh pr merge`.
//
// After the run you QA the local feature branch, then push it and open ONE PR to
// `main` yourself — CI runs there. See docs/adr/0010 and docs/sandcastle/RUNBOOK.md.
//
// TWO MODES (see the run plan below):
//   • prd   — the model above: `--prd <n>`, integrating into `feat/<slug>`.
//   • issue — `--issue <n>` with NO `--prd`. One ad-hoc issue, cut from origin/main
//     (or `--base`). There is no integration branch, so the work branch IS the
//     deliverable: gate green ends the run, the issue is left OPEN, and nothing is
//     fast-forwarded. Same sandbox, same in-container install, same gate.

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fail(message: string, code = 1): never {
  console.error(`\nError: ${message}`);
  process.exit(code);
}

/** The Claude Code version the sandbox image carries, or null without one. */
function imageClaudeCodeVersion(): string | null {
  const probe = spawnSync(
    'docker',
    ['run', '--rm', '--entrypoint', 'claude', SANDBOX_IMAGE, '--version'],
    { encoding: 'utf8', windowsHide: true },
  );
  return probe.status === 0 ? parseClaudeCodeVersion(probe.stdout) : null;
}

/** The current release on the channel the installer reads, or null offline. */
async function latestClaudeCodeRelease(): Promise<string | null> {
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? parseReleaseVersion(await response.text()) : null;
  } catch {
    return null;
  }
}

type SandboxClaudeCode = { version: string; mode: 'auto' | 'manual' };

/**
 * Builds the sandbox image when it is missing, or when its Claude Code is not
 * the version the policy asks for, and returns the version it verified.
 * Without the version check an existing image keeps whatever CLI it was built
 * with, whatever the environment says.
 *
 * Auto mode asks the release channel for the current version on every
 * dispatch. Offline, it keeps an existing image as it is, and builds a missing
 * one with the installer's own `latest`.
 *
 * With no policy — a Cursor or Copilot dispatch, where Claude Code never runs
 * — the image is only built when missing, and no version is returned to log.
 */
async function ensureSandboxImage(
  policy: ReturnType<typeof claudeCodePolicy> | null,
): Promise<SandboxClaudeCode | null> {
  const image = spawnSync('docker', ['image', 'inspect', SANDBOX_IMAGE], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (!policy && image.status === 0) return null;
  const installed =
    policy && image.status === 0 ? imageClaudeCodeVersion() : null;

  let wanted: string | null;
  if (!policy) {
    wanted = null;
  } else if (policy.mode === 'manual') {
    wanted = policy.version;
  } else {
    wanted = await latestClaudeCodeRelease();
    if (!wanted) {
      console.warn(
        `Could not read the latest Claude Code release from ${LATEST_RELEASE_URL}.`,
      );
      if (installed) {
        console.warn(`Keeping ${SANDBOX_IMAGE} on Claude Code ${installed}.`);
        return { version: installed, mode: policy.mode };
      }
    }
  }

  if (policy && installed && installed === wanted) {
    return { version: installed, mode: policy.mode };
  }
  console.log(
    policy && image.status === 0
      ? `Sandbox image ${SANDBOX_IMAGE} carries Claude Code ${installed ?? '(none found)'}, ` +
          `but ${describeClaudeCodeMode(policy.mode)} wants ${wanted}; rebuilding it before dispatch...`
      : `Sandbox image ${SANDBOX_IMAGE} is missing; building it before dispatch...`,
  );

  // `sandcastle docker build-image` passes only the uid/gid build args, so this
  // is its build with the Claude Code version added.
  const buildArgs: Record<string, string> = {
    CLAUDE_CODE_VERSION: wanted ?? 'latest',
  };
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid !== undefined) buildArgs.AGENT_UID = String(uid);
  if (gid !== undefined) buildArgs.AGENT_GID = String(gid);
  const build = spawnSync(
    'docker',
    [
      'build',
      '-t',
      SANDBOX_IMAGE,
      ...Object.entries(buildArgs).flatMap(([key, value]) => [
        '--build-arg',
        `${key}=${value}`,
      ]),
      join(process.cwd(), '.sandcastle'),
    ],
    { encoding: 'utf8', stdio: 'inherit', windowsHide: true },
  );

  if (build.status !== 0) {
    fail(
      `Could not build ${SANDBOX_IMAGE}. Check that Docker is running and the active Docker context can build images.`,
    );
  }

  const verification = spawnSync(
    'docker',
    ['image', 'inspect', SANDBOX_IMAGE],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (verification.status !== 0) {
    fail(
      `Docker image ${SANDBOX_IMAGE} was reported built but is not available.`,
    );
  }
  if (!policy) return null;
  const built = imageClaudeCodeVersion();
  if (!built || (wanted && built !== wanted)) {
    fail(
      `Docker image ${SANDBOX_IMAGE} was built but carries Claude Code ` +
        `${built ?? '(none found)'}, not ${wanted ?? 'a readable version'}.`,
    );
  }
  return { version: built, mode: policy.mode };
}

/**
 * Maps the files a slice changed (between base and head) to the Nx projects that
 * OWN them — the project rooted at the nearest ancestor `project.json` for each
 * file. Unlike `nx show projects --affected`, this excludes transitive dependents:
 * a change to shared `vault-core` returns only `vault-core` (+ any other project
 * whose own files changed), NOT every web page that imports it. This is the
 * correct scope for a LINT gate, where lint is per-file and an upstream change
 * cannot introduce lint errors in unchanged downstream files.
 *
 * This scope is WRONG for type and test gates: a lib whose own files changed can
 * absolutely break an unchanged consumer's compile or suite. Those targets use
 * `affectedProjects` instead.
 */
function changedProjects(base: string, head: string): string[] {
  // Three-dot range: diff the slice head against the MERGE-BASE, i.e. only the
  // files the slice itself introduced — not files where the slice is merely
  // behind an advanced base.
  const diff = spawnSync('git', ['diff', '--name-only', `${base}...${head}`], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const files = (diff.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const names = new Set<string>();
  for (const file of files) {
    // Walk up the path segments looking for the nearest project.json.
    const segments = file.split('/');
    for (let i = segments.length - 1; i > 0; i--) {
      const dir = segments.slice(0, i).join('/');
      const pjPath = join(process.cwd(), dir, 'project.json');
      if (existsSync(pjPath)) {
        try {
          const pj = JSON.parse(readFileSync(pjPath, 'utf8')) as {
            name?: string;
          };
          if (pj.name) names.add(pj.name);
        } catch {
          /* ignore unparseable project.json */
        }
        break;
      }
    }
  }
  return [...names];
}

/**
 * The Nx projects a slice affects: the projects whose own files changed PLUS every
 * transitive dependent. This is the correct scope for TYPE and TEST gates — a type
 * error introduced in `web-pages-dashboard` surfaces when `web` compiles,
 * and that consumer's own files never changed.
 *
 * Computed on the HOST, not in the gate container: the gate bind-mounts only the
 * worktree directory, and a linked worktree's `.git` is a file pointing at the
 * parent repo's git dir, so git (and therefore `--affected`) cannot resolve refs
 * inside the container. The resolved list is passed to nx as an explicit
 * `--projects=` argument instead.
 *
 * Returns `null` when the project graph cannot be read, so the caller can fail
 * closed rather than silently gating a narrower set than intended. The reason is
 * logged here — the caller only knows that resolution failed, not why.
 */
function affectedProjects(base: string, head: string): string[] | null {
  const shown = spawnSync(
    'npx',
    [
      'nx',
      'show',
      'projects',
      '--affected',
      // Explicit, never inferred. `nx show` auto-enables JSON only when its
      // `isAiAgent()` probe fires (CLAUDECODE / CLAUDE_CODE and friends), so
      // without this flag the identical command prints a newline-delimited list
      // when run from a plain terminal, JSON.parse throws, and EVERY slice fails
      // the gate on an unresolvable graph. CI passes it too — see
      // .github/workflows/ci.yml.
      '--json',
      `--base=${base}`,
      `--head=${head}`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 300000 },
  );

  // Every path below returns `null`, and the caller reports only "could not
  // resolve the affected project graph". Name the actual cause here or the next
  // breakage costs a whole wave to diagnose.
  const unresolved = (reason: string): null => {
    const detail = (shown.stderr || shown.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);
    console.error(
      `  nx show projects --affected ${reason}${detail ? `: ${detail}` : ''}`,
    );
    return null;
  };

  if (shown.error) return unresolved(`could not run (${shown.error.message})`);
  if (shown.status !== 0) return unresolved(`exited ${shown.status}`);
  try {
    const parsed = JSON.parse(shown.stdout) as unknown;
    if (!Array.isArray(parsed))
      return unresolved('returned a non-array JSON payload');
    return parsed.filter((name): name is string => typeof name === 'string');
  } catch {
    return unresolved('returned output that is not JSON');
  }
}

function ghJson<T>(args: string[]): T {
  const r = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true });
  if (r.error) fail(`gh error: ${r.error.message}`);
  if (r.status !== 0) fail(`gh failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout) as T;
}

function ghSilent(args: string[]): void {
  spawnSync('gh', args, { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
}

function gitCmd(args: string[]): string {
  const r = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  if (r.error) fail(`git error: ${r.error.message}`);
  if (r.status !== 0) fail(`git ${args.join(' ')} failed:\n${r.stderr.trim()}`);
  return r.stdout.trim();
}

/**
 * Put an empty anchor commit on a branch whose NAME carries no issue number, so
 * `/code-review` can resolve a spec for the pull request opened from it through
 * the commit step of its existing discovery order (ADR 0076).
 *
 * Written with `commit-tree` rather than `git commit` on purpose: the branch is
 * not checked out — the PRD branch is created before any worktree exists — and
 * plumbing needs no worktree, no checkout dance, and runs no hooks, so there is
 * nothing here to skip with `--no-verify`.
 *
 * The commit is empty, so it changes no diff, no `origin/main...feat/<slug>`
 * gate scope, and no fast-forward: slices are cut from the branch AFTER this
 * runs and therefore contain it already.
 */
function anchorBranchToIssue(branch: string, issue: number, title?: string) {
  if (branchNameCarriesIssue(branch, issue)) return;
  const tree = gitCmd(['rev-parse', `${branch}^{tree}`]);
  const commit = gitCmd([
    'commit-tree',
    tree,
    '-p',
    branch,
    '-m',
    specAnchorMessage({ branch, issue, title }),
  ]);
  gitCmd(['branch', '-f', branch, commit]);
  console.log(`Anchored ${branch} to #${issue} (empty first commit).`);
}

/** True if the git ref resolves locally (branch, remote-tracking ref, or sha). */
function gitRefExists(ref: string): boolean {
  return (
    spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      encoding: 'utf8',
      windowsHide: true,
    }).status === 0
  );
}

// ─── Parse arguments ─────────────────────────────────────────────────────────

function getArgValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const withEquals = process.argv.find((arg) => arg.startsWith(prefix));
  if (withEquals) return withEquals.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function printHelp(): void {
  console.log(`
Usage:
  PRD mode        yarn dispatch-agents --prd <issue-number> [--issue <slice-number>]
  Standalone mode yarn dispatch-agents --issue <issue-number> [--base <ref>]
  Sweep mode      yarn dispatch-agents --all-standalone [--limit <n>] [--base <ref>]

  All accept [--agent claude|cursor|copilot] [--model <model>] [--dry-run]
  Interrupted slices resume by default; --fresh discards one deliberately.

Flags:
  --prd <issue-number>   PRD issue number to dispatch. Slices integrate into the
                         local feat/<slug> branch, one by one.
  --issue <number>       With --prd: dispatch only this slice of that PRD.
                         Without --prd: standalone mode — dispatch this one issue
                         off --base, leave the result on its own local branch.
  --all-standalone       Sweep mode: dispatch every open issue labelled
                         ready-for-agent + type:afk that is not a PRD slice, each
                         on its own branch. Skips type:hitl, status:blocked, and
                         status:in-progress. Prompts for confirmation first.
  --limit <n>            Sweep mode only: cap how many issues are dispatched.
  --base <ref>           Standalone and sweep modes: base ref for work branches
                         (default: origin/main).
  --dry-run              Resolve and print the plan — issues, branches, models,
                         base, integration target — then exit. Touches no worktree,
                         container, or GitHub state, and builds no sandbox image.
  --yes, -y              Skip the sweep confirmation prompt.
  --wait-for-quota       On a provider usage limit, park the run until the limit
                         resets and then resume the slice, instead of exiting.
                         Capped at 2 waits per run; never sleeps on an unreadable
                         reset time, and never on a provider whose limit format
                         is unknown.
  --fresh                Discard a slice's preserved checkpoint and start it over.
                         Without it, an interrupted slice RESUMES. In PRD mode this
                         must name its slice: --prd <n> --issue <slice> --fresh.
  --defer-gate           Skip the end-of-run feature-branch gate (dispatch-waves
                         passes this; it gates once after the last wave).
  --gate-only            Run only the feature-branch gate for --prd, then exit.
  --trace-subagents      Write per-sub-agent transcripts to
                         .sandcastle/logs/subagents/<issue>/, each with its tool
                         calls, peak context, and token usage. Without it, output is
                         byte-for-byte what it is today — one flat log per slice.
  --agent <name>         Agent provider to use (default: SANDCASTLE_AGENT or claude)
  --model <model>        Override the model for this run (default: env/provider routing)
  --help                 Show this help text

Work branches are named <type>/<issue-number>-<slug>, with <type> derived from the
issue's labels (see AGENTS.md "Branch naming"). PRD slices use slice/<n>-<slug>.

Environment:
  .sandcastle/.env is loaded automatically.
  SANDCASTLE_AGENT
  SANDCASTLE_MODEL
  SANDCASTLE_CLAUDE_MODEL
  SANDCASTLE_CURSOR_MODEL
  SANDCASTLE_COPILOT_MODEL

Claude Code in the sandbox image (rebuilt at dispatch when it differs):
  SANDCASTLE_CLAUDE_CODE_UPDATE   \`auto\` follows the latest release; \`manual\` stays on
                                  SANDCASTLE_CLAUDE_CODE_VERSION. Unset: auto, or
                                  manual when a version is set.
  SANDCASTLE_CLAUDE_CODE_VERSION  Exact version for manual mode, e.g. 2.1.310.

Claude auth (see docs/sandcastle/RUNBOOK.md):
  CLAUDE_CODE_OAUTH_TOKEN  Pro/Max subscription token from \`claude setup-token\`.
                           Takes precedence; ANTHROPIC_API_KEY is then NOT forwarded.
  ANTHROPIC_API_KEY        Metered API billing. Used only when no OAuth token is set.
  SANDCASTLE_CLAUDE_AUTH   Force one mode: \`subscription\` or \`api\`. Fails if the
                           matching credential is missing.
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const USAGE =
  'Usage: yarn dispatch-agents --prd <issue-number> [--issue <slice-number>]\n' +
  '   or: yarn dispatch-agents --issue <issue-number> [--base <ref>]   (standalone, no PRD)\n' +
  '   or: yarn dispatch-agents --all-standalone [--limit <n>] [--base <ref>]   (sweep)';

const prdValue = getArgValue('prd');
const issueValue = getArgValue('issue');
const sweepFlag = process.argv.includes('--all-standalone');

if (!prdValue && !issueValue && !sweepFlag) fail(USAGE);

if (sweepFlag && (prdValue || issueValue)) {
  fail(
    '--all-standalone selects the issue set itself and cannot be combined with --prd or --issue.',
  );
}

const prdNumber = prdValue ? parseInt(prdValue, 10) : undefined;
if (prdValue && isNaN(prdNumber as number)) fail('--prd must be a number.');

const issueNumber = issueValue ? parseInt(issueValue, 10) : undefined;
if (issueValue && isNaN(issueNumber as number)) {
  fail('--issue must be a number.');
}

// Three modes:
//   prd    — slices of one PRD, integrated into a local feat/<slug> branch.
//   issue  — one explicitly named issue. The work branch IS the deliverable:
//            nothing is fast-forwarded and nothing is closed, because the work
//            only reaches `main` once you push the branch and open a PR yourself.
//   sweep  — every agent-ready ad-hoc issue, each handled exactly like `issue`.
//            Nothing was named by a human here, so the label gate is enforced
//            strictly and the selection is confirmed before anything runs.
const mode: 'prd' | 'issue' | 'sweep' = sweepFlag
  ? 'sweep'
  : prdNumber === undefined
    ? 'issue'
    : 'prd';

const baseFlag = getArgValue('base');
if (baseFlag && mode === 'prd') {
  fail(
    '--base applies to standalone and sweep modes only. In PRD mode every slice is cut from the local feature branch.',
  );
}

const dryRun = process.argv.includes('--dry-run');
const assumeYes = process.argv.includes('--yes') || process.argv.includes('-y');

// Resume is the default for a slice carrying a checkpoint, so discarding that work
// is an explicit act. Scope is validated once the mode is known — see below.
const discardRequested = isDiscardRequested(process.argv);

// Opt-in: a run that goes silent for hours is a severe surprise, so the flag
// documents the behaviour at the call site. See ADR 0035.
const waitForQuota = process.argv.includes('--wait-for-quota');
let quotaWaitsTaken = 0;

// Opt-in, per ADR 0036: without it, output stays byte-for-byte what it is today — one
// flat log per slice. Sandcastle 0.12.0 already captures every sub-agent transcript to
// the host unconditionally (see captureSubagentTraces below); this flag only decides
// whether main.mts relocates and summarizes what was already captured.
const traceSubagents = process.argv.includes('--trace-subagents');

// Suppress the end-of-run feature gate. Only dispatch-waves passes this: it calls
// this file once per wave, and the PRD should be gated once, after the last one.
const deferGate = process.argv.includes('--defer-gate');

// Run ONLY the feature-branch gate and exit. dispatch-waves uses this after its
// last wave so the PRD is gated exactly once, whichever waves actually ran.
const gateOnly = process.argv.includes('--gate-only');

const discardScope = validateDiscardScope({
  discardRequested,
  mode,
  issueNumber,
});
if (!discardScope.ok) fail(discardScope.message);

const limitValue = getArgValue('limit');
if (limitValue && mode !== 'sweep') {
  fail('--limit applies to --all-standalone only.');
}
const limit = limitValue ? parseInt(limitValue, 10) : undefined;
if (limitValue && (isNaN(limit as number) || (limit as number) < 1)) {
  fail('--limit must be a positive number.');
}

const agentFlag = getArgValue('agent');
const modelFlag = getArgValue('model');

// ─── Claude auth mode ─────────────────────────────────────────────────────────
// Two ways to authenticate the Claude Code agent inside the sandbox:
//
//   • subscription — CLAUDE_CODE_OAUTH_TOKEN, produced by `claude setup-token` on
//     the host (requires an active Pro/Max plan). Bills against that plan, which is
//     the SAME quota as your interactive Claude Code sessions: a long AFK batch of
//     complexity:high (opus) slices can throttle you at the keyboard.
//   • api — ANTHROPIC_API_KEY. Metered per token, isolated from the plan quota.
//
// We forward exactly ONE of them into the container. Which credential Claude Code
// prefers when both are present is version-dependent, so a stale ANTHROPIC_API_KEY
// sitting next to a valid token can silently bill the API while you believe you are
// on the plan. Resolve the mode up front, fail loudly if the credential is missing
// (before we build worktrees and containers), and print the mode in the run header.

type ClaudeAuthMode = 'subscription' | 'api';

/** `null` = no credential needed (not a claude run). `'none'` = needed, absent. */
type ClaudeAuthResolution = ClaudeAuthMode | 'none' | null;

/**
 * Which Claude credential this run will use.
 *
 * `preview` softens the MISSING-credential paths from a hard exit to `'none'`, so a
 * `--dry-run` can still show the plan on a machine where the 1Password injection was
 * never set up. It reports the gap rather than hiding it — a preview that cannot say
 * "this run would not authenticate" is worse than one that dies. A malformed
 * SANDCASTLE_CLAUDE_AUTH still fails outright either way: that is a typo, not an
 * absent secret, and the run can never succeed with it.
 */
function resolveClaudeAuth(
  kind: AgentKind,
  { preview = false }: { preview?: boolean } = {},
): ClaudeAuthResolution {
  if (kind !== 'claude') return null;

  const hasToken = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const forced = (process.env.SANDCASTLE_CLAUDE_AUTH ?? '')
    .trim()
    .toLowerCase();

  if (forced && forced !== 'subscription' && forced !== 'api') {
    fail(
      `SANDCASTLE_CLAUDE_AUTH must be "subscription" or "api" (got "${forced}").`,
    );
  }

  if (forced === 'subscription' && !hasToken) {
    if (preview) return 'none';
    fail(
      'SANDCASTLE_CLAUDE_AUTH=subscription but CLAUDE_CODE_OAUTH_TOKEN is not set.\n' +
        'Run `claude setup-token` on the host and store the result in your 1Password Environment.',
    );
  }
  if (forced === 'api' && !hasApiKey) {
    if (preview) return 'none';
    fail('SANDCASTLE_CLAUDE_AUTH=api but ANTHROPIC_API_KEY is not set.');
  }

  if (forced === 'subscription' || forced === 'api') return forced;

  // Unforced: the subscription token wins when both are available.
  if (hasToken) return 'subscription';
  if (hasApiKey) return 'api';

  if (preview) return 'none';
  fail(
    'No Claude credential found. Set one of:\n' +
      '  CLAUDE_CODE_OAUTH_TOKEN  — `claude setup-token` on the host (Pro/Max plan)\n' +
      '  ANTHROPIC_API_KEY        — metered API billing\n' +
      'See docs/sandcastle/RUNBOOK.md. Both are normally injected via 1Password.',
  );
}

const agentKind = resolveAgentKind();
// --gate-only launches no agent, so it must not demand an agent credential. It is
// the path a maintainer runs by hand to re-check a feature branch, often on a
// machine where the 1Password injection was never set up.
// Neither --gate-only nor --dry-run launches an agent, so neither may demand an
// agent credential. --gate-only needs none at all; --dry-run previews the plan and
// reports the missing credential instead of dying on it.
const claudeAuth = gateOnly
  ? null
  : resolveClaudeAuth(agentKind, { preview: dryRun });

// Only now — after --help, argument validation, and the credential preflight have
// all had their say. Building this image can take minutes; there is no reason to
// pay for it before we know the run can actually authenticate. A --dry-run never
// launches a container, so it must not pay for the image either.
// The Claude Code policy is read either way, so a typo in its variables fails a
// dry run too instead of waiting for the first real dispatch.
let claudeCodeUpdatePolicy: ReturnType<typeof claudeCodePolicy>;
try {
  claudeCodeUpdatePolicy = claudeCodePolicy(process.env);
} catch (error) {
  fail((error as Error).message);
}
// Only a Claude dispatch runs Claude Code, so only it checks or rebuilds for the
// CLI version, and only its slice logs name one.
const sandboxClaudeCode = dryRun
  ? null
  : await ensureSandboxImage(
      agentKind === 'claude' ? claudeCodeUpdatePolicy : null,
    );
if (sandboxClaudeCode) {
  console.log(
    `Sandbox image ${SANDBOX_IMAGE}: Claude Code ${sandboxClaudeCode.version} ` +
      `(${describeClaudeCodeMode(sandboxClaudeCode.mode)}).`,
  );
}

// ─── Fetch PRD issue ──────────────────────────────────────────────────────────

type Issue = {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  labels: Array<{ name: string }>;
  body: string;
};

// `issue list` is capped, so a `## Blocked by` entry naming an older issue — a
// standalone bug outside the PRD, say — is often not in the listing. Fetch it on
// demand. Unlike `ghJson`, a failed lookup must not abort the run: an issue that
// cannot be read is reported as an unfinished dependency, not as a crash.
const fetchedIssues = new Map<number, Issue | undefined>();

function fetchIssue(number: number): Issue | undefined {
  if (fetchedIssues.has(number)) return fetchedIssues.get(number);
  const r = spawnSync(
    'gh',
    [
      'issue',
      'view',
      String(number),
      '--repo',
      REPO,
      '--json',
      'number,title,state,labels,body',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const issue =
    r.status === 0 && !r.error ? (JSON.parse(r.stdout) as Issue) : undefined;
  if (!issue) {
    console.warn(`  could not load dependency #${number}: ${r.stderr?.trim()}`);
  }
  fetchedIssues.set(number, issue);
  return issue;
}

/**
 * After a slice completes, clear `status:blocked` on dependents whose
 * ## Blocked by deps are all done/closed. Prefer ## Blocks on the completed
 * issue; also scan same-PRD open slices as a fallback.
 */
function unblockDependents(completed: Issue): void {
  const prdMatch = completed.body?.match(/PRD:\s*#(\d+)/i);
  const prdRef = prdMatch ? `PRD: #${prdMatch[1]}` : null;

  const candidateNumbers = new Set<number>(blocks(completed));
  for (const issue of allIssues) {
    if (issue.number === completed.number) continue;
    if (prdRef && !issue.body?.includes(prdRef)) continue;
    if (blockedBy(issue).includes(completed.number)) {
      candidateNumbers.add(issue.number);
    }
  }

  if (candidateNumbers.size === 0) return;

  // Refresh issue metadata for accurate labels/state.
  const byNumber = new Map<number, Issue>();
  for (const issue of allIssues) {
    byNumber.set(issue.number, issue);
  }
  byNumber.set(completed.number, {
    ...completed,
    state: 'CLOSED',
    labels: [
      ...completed.labels.filter((l) => l.name !== 'status:in-progress'),
      { name: 'status:done' },
    ],
  });

  for (const dependentNumber of candidateNumbers) {
    let dependent = byNumber.get(dependentNumber);
    if (!dependent) {
      try {
        dependent = ghJson<Issue>([
          'issue',
          'view',
          String(dependentNumber),
          '--repo',
          REPO,
          '--json',
          'number,title,state,labels,body',
        ]);
        byNumber.set(dependentNumber, dependent);
      } catch {
        console.warn(
          `  [#${completed.number}] unblock: could not load dependent #${dependentNumber}`,
        );
        continue;
      }
    }

    if (!dependent.labels.some((l) => l.name === 'status:blocked')) {
      continue;
    }

    // byNumber already carries `completed` as CLOSED, so it resolves as satisfied.
    const unfinished = unfinishedDependencies(dependent, {
      lookup: (number: number) => byNumber.get(number) ?? fetchIssue(number),
    });

    if (unfinished.length > 0) {
      console.log(
        `  [#${completed.number}] #${dependentNumber} still blocked by ${unfinished
          .map((n) => `#${n}`)
          .join(', ')}`,
      );
      continue;
    }

    ghSilent([
      'issue',
      'edit',
      String(dependentNumber),
      '--repo',
      REPO,
      '--remove-label',
      'status:blocked',
    ]);
    ghSilent([
      'issue',
      'comment',
      String(dependentNumber),
      '--repo',
      REPO,
      '--body',
      `Unblocked: #${completed.number} is done. Remaining blockers: none — ready for agent.`,
    ]);
    console.log(
      `  [#${completed.number}] removed status:blocked from #${dependentNumber}`,
    );
  }
}

// ─── Build the run plan ───────────────────────────────────────────────────────
// The modes differ in exactly three things — where work branches are cut from,
// whether finished work is fast-forwarded anywhere, and how the issue set is chosen.
// Everything downstream (sandbox, in-container install, gate, prompt, usage log)
// is shared and reads from this plan.
//
//   prd   — integrationBranch = local `feat/<slug>`, also the base each slice is cut
//           from, so slice N sees slices 1..N-1. Issues are the PRD's ready AFK
//           slices, ordered by `## Blocked by`.
//   issue — integrationBranch = null. One explicitly named issue, cut from
//           origin/main (or --base). Its branch IS the deliverable: nothing is
//           fast-forwarded, nothing is closed. You QA it, push it, open the PR.
//   sweep — identical to `issue` in every downstream respect, run once per selected
//           issue. Only the selection differs, and it is the one place where nobody
//           named an issue by hand — so the label gate is enforced rather than
//           warned about, and the whole set is confirmed before the first container.

gitCmd(['fetch', 'origin', 'main']);

type RunPlan = {
  /** Ref every work branch is cut from, and the gate's diff base. */
  baseRef: string;
  /** Local branch finished work fast-forwards into; null in standalone mode. */
  integrationBranch: string | null;
  issues: Issue[];
  /** Full repo issue list, for dependency unblocking. Empty in standalone mode. */
  allIssues: Issue[];
};

function planPrdRun(prd: number): RunPlan {
  const prdIssue = ghJson<Pick<Issue, 'title' | 'body'>>([
    'issue',
    'view',
    String(prd),
    '--repo',
    REPO,
    '--json',
    'title,body',
  ]);

  const name = prdIssue.title.replace(/^\[PRD\]\s*/i, '').trim();
  const branch = `feat/${prdBranchSlug(name)}`;

  console.log(`\nPRD #${prd}: ${name}`);
  console.log(`Feature branch:  ${branch} (local only — never pushed)`);

  // The PRD branch is created once, locally, from the freshest main. It is the
  // integration target for every slice in this PRD. We do NOT create it on origin
  // and we do NOT push it — you push it by hand after QA to open the PRD PR.
  // A --dry-run must not leave it behind either: creating the branch is a real
  // mutation, and a preview that alters the repo is not a preview.
  if (gitRefExists(branch)) {
    console.log(`Reusing existing local branch ${branch}.`);
  } else if (dryRun) {
    console.log(`Would create local branch ${branch} from origin/main.`);
  } else {
    const base = gitRefExists('origin/main') ? 'origin/main' : 'main';
    // `--no-track` is load-bearing. Git's `branch.autoSetupMerge` defaults to
    // true, so branching from the remote-tracking ref `origin/main` would set
    // this branch's upstream to `refs/heads/main` — and a later `git push` from
    // it would land the PRD's commits directly on main, unreviewed. That is the
    // opposite of the comment above: this branch is created so a human can open
    // a PR from it.
    gitCmd(['branch', '--no-track', branch, base]);
    console.log(`Created local branch ${branch} from ${base} (not pushed).`);
    // `feat/<prd-slug>` names the PRD's title, not its number, so the reviewer's
    // branch-name step cannot match it. Anchor it before any slice is cut.
    anchorBranchToIssue(branch, prd, name);
  }

  const everyIssue = ghJson<Issue[]>([
    'issue',
    'list',
    '--repo',
    REPO,
    '--state',
    'all',
    '--json',
    'number,title,state,labels,body',
    '--limit',
    '100',
  ]);

  // `status:blocked` is NOT an entry filter. This run maintains that label itself:
  // it strips it from a dependent the moment its blocker completes. Filtering on it
  // up front made the run refuse to consider the very slices it was about to
  // unblock — PRD #461 dispatched one of three slices and stopped. A slice whose
  // `## Blocked by` names another slice of this PRD is admitted, and `## Blocked by`
  // ordering in the dispatch loop decides when it may actually run. A slice whose
  // label is NOT explained that way stays out: it means something this code cannot
  // evaluate. See tools/scripts/lib/sandcastle-slice-selection.ts.
  const selection = selectPrdSlices(everyIssue, {
    prd,
    only: issueNumber,
  });
  const selected = selection.selected;

  if (selection.admitted.length > 0) {
    console.log(
      `Admitted ${selection.admitted
        .map((i) => `#${i.number}`)
        .join(', ')} despite status:blocked — blocked by a slice in this run.`,
    );
  }
  for (const { issue, reason } of selection.deferred) {
    console.log(`Deferred #${issue.number}: ${reason}.`);
  }

  // --gate-only never dispatches, so an empty ready set is normal for it: by the
  // time the PRD is gated its slices are closed, and the wave driver has stripped
  // ready-for-agent from the rest. Only the feature branch matters here.
  if (selected.length === 0 && !gateOnly) {
    fail(
      issueNumber === undefined
        ? `No open AFK slice issues found for PRD #${prd}.\n` +
            `Run /to-issues ${prd} to create them first.`
        : `Slice issue #${issueNumber} was not found as an open AFK slice for PRD #${prd}.\n` +
            `Check its labels and PRD reference, or run it standalone:\n` +
            `  yarn dispatch-agents --issue ${issueNumber}`,
    );
  }

  return {
    baseRef: branch,
    integrationBranch: branch,
    issues: selected,
    allIssues: everyIssue,
  };
}

function planStandaloneRun(number: number): RunPlan {
  const issue = ghJson<Issue>([
    'issue',
    'view',
    String(number),
    '--repo',
    REPO,
    '--json',
    'number,title,state,labels,body',
  ]);

  if (issue.state === 'CLOSED') {
    fail(`Issue #${number} is closed. Reopen it before dispatching.`);
  }

  const base =
    baseFlag ?? (gitRefExists('origin/main') ? 'origin/main' : 'main');
  if (!gitRefExists(base)) fail(`Base ref "${base}" does not resolve locally.`);

  console.log(`\nIssue #${number}: ${issue.title}`);
  console.log(`Base:            ${base}`);
  console.log(`Standalone — no PRD, no integration branch. Nothing is pushed.`);

  // Naming the issue explicitly IS the authorization: standalone runs do not
  // require ready-for-agent / type:afk. Labels that normally mean "a human wanted
  // this one" are surfaced as warnings so a mis-typed number is still visible.
  const labels = issue.labels.map((label) => label.name);
  for (const flagged of ['type:hitl', 'status:blocked', 'status:in-progress']) {
    if (labels.includes(flagged)) {
      console.warn(`  ⚠ #${number} carries "${flagged}" — dispatching anyway.`);
    }
  }

  return {
    baseRef: base,
    integrationBranch: null,
    issues: [issue],
    allIssues: [],
  };
}

/**
 * Every open issue the orchestrator may pick up on its own authority: explicitly
 * marked agent-ready, not part of a PRD (those belong to `--prd`, which orders them
 * by dependency and integrates them), and not carrying a label that means a human
 * still has to look at it.
 *
 * The `type:hitl` / `status:blocked` warnings that standalone mode prints are hard
 * exclusions here. Standalone treats naming an issue as the authorization; a sweep
 * has no such signal, so the labels are the only gate there is.
 */
function planSweepRun(): RunPlan {
  const base =
    baseFlag ?? (gitRefExists('origin/main') ? 'origin/main' : 'main');
  if (!gitRefExists(base)) fail(`Base ref "${base}" does not resolve locally.`);

  const everyIssue = ghJson<Issue[]>([
    'issue',
    'list',
    '--repo',
    REPO,
    '--state',
    'open',
    '--json',
    'number,title,state,labels,body',
    '--limit',
    '200',
  ]);

  const eligible = everyIssue.filter((issue) => {
    const labels = issue.labels.map((label) => label.name);
    return (
      labels.includes('ready-for-agent') &&
      labels.includes('type:afk') &&
      !labels.includes('type:hitl') &&
      !labels.includes('status:blocked') &&
      !labels.includes('status:in-progress') &&
      // A PRD parent is a spec, not implementable work, and its body carries
      // `## Slices` rather than a `PRD: #` back-reference — so the slice filter
      // below would not catch it.
      !labels.includes('prd') &&
      // PRD slices are `--prd`'s business: it orders them by `## Blocked by` and
      // integrates them into a feature branch. Sweeping them one-off would strand
      // each on its own branch with no integration target.
      !/^\s*PRD:\s*#\d+/m.test(issue.body ?? '')
    );
  });

  const selected = [...eligible]
    .sort((left, right) => left.number - right.number)
    .slice(0, limit ?? eligible.length);

  if (selected.length === 0) {
    fail(
      'No eligible issues for a sweep.\n' +
        'An issue qualifies when it is open, labelled `ready-for-agent` + `type:afk`,\n' +
        'carries no `type:hitl` / `status:blocked` / `status:in-progress`, and has no\n' +
        '`PRD: #<n>` reference (PRD slices belong to `--prd`).',
    );
  }

  console.log(`\nSweep — every agent-ready ad-hoc issue.`);
  console.log(`Base:            ${base}`);
  console.log(
    `Selected:        ${selected.length} of ${eligible.length} eligible` +
      (limit !== undefined && eligible.length > selected.length
        ? ` (--limit ${limit})`
        : ''),
  );
  console.log(`No integration branch. Nothing is pushed, nothing is closed.`);

  return {
    baseRef: base,
    integrationBranch: null,
    issues: selected,
    allIssues: [],
  };
}

const plan =
  mode === 'prd'
    ? planPrdRun(prdNumber as number)
    : mode === 'sweep'
      ? planSweepRun()
      : planStandaloneRun(issueNumber as number);

const { baseRef, integrationBranch, allIssues } = plan;

// The ref the PRD's feature branch was cut from, and therefore the ref its PR will
// target. `baseRef` cannot serve: in PRD mode it is the feature branch itself,
// which advances with every integrated slice, so diffing against it would show the
// last slice only. See ADR 0045.
const prdGateBase = gitRefExists('origin/main') ? 'origin/main' : 'main';

const slices = plan.issues;

console.log(
  `Agent:           ${agentKind}${
    claudeAuth === 'subscription'
      ? ' (auth: subscription — shares your Pro/Max quota)'
      : claudeAuth === 'api'
        ? ' (auth: API key — metered)'
        : claudeAuth === 'none'
          ? ' (auth: NONE FOUND — preview only; a real run needs ' +
            'CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)'
          : ''
  }\n`,
);

const completedIssueNumbers = new Set(
  allIssues
    .filter(
      (issue) =>
        issue.body?.includes(`PRD: #${prdNumber}`) &&
        isSatisfiedAsDependency(issue),
    )
    .map((issue) => issue.number),
);

// A dependency is satisfied by completing in this run, or by being complete on
// GitHub — closed or `status:done` — whether or not it is a slice of this PRD.
// Counting only this PRD's slices stranded #772's #787 behind #771, a standalone
// bug that had already closed. See isDependencySatisfied.
const dependencyStatus = {
  completed: completedIssueNumbers,
  lookup: (number: number) =>
    allIssues.find((issue) => issue.number === number) ?? fetchIssue(number),
};

function nextReadySlice(pending: Issue[]): Issue | undefined {
  // `## Blocked by` ordering is PRD vocabulary. Standalone runs a single issue the
  // human named explicitly — honouring a stale blocker section there would silently
  // refuse to run it, since completedIssueNumbers is empty by construction.
  const ready =
    mode === 'prd'
      ? pending.filter(
          (issue) =>
            unfinishedDependencies(issue, dependencyStatus).length === 0,
        )
      : pending;

  return ready.sort((left, right) => left.number - right.number)[0];
}

// ─── Dependency install model ─────────────────────────────────────────────────
// Each slice's node_modules is installed INSIDE the Linux container by a
// `hooks.sandbox.onSandboxReady` hook that runs `corepack yarn install --immutable`
// before the agent starts (see the run() call below). Installing in-container means
// the native binaries (bcrypt, prisma, @swc/core) are always built for the
// container's platform — so dispatch works correctly on WSL2, native Linux, AND
// macOS hosts (a host-side install would bake in the host's wrong-arch binaries).
//
// Yarn's global cache is bind-mounted from .sandcastle/.yarn-cache (host) into every
// container, so it survives across runs and is shared between slices. It is
// content-addressable, so it NEVER needs full invalidation. Repeat installs are
// incremental.
//
// The ONLY environment requirement: the worktree must live on a NATIVE filesystem
// (ext4 on Linux/WSL2, APFS on macOS) — NOT a Windows-mounted path (/mnt/d, drvfs),
// where the same install takes ~29 min instead of ~2 min. On Windows that means
// running dispatch from inside WSL2 with the repo on ext4. See docs/adr/0009 and
// docs/sandcastle/RUNBOOK.md.

// Shared, content-addressable Yarn global cache, bind-mounted into every agent and
// gate container at /home/agent/.yarn-cache (see YARN_GLOBAL_FOLDER below). Created
// here so sandcastle's mount validation (which requires the host path to exist)
// passes on a fresh checkout.
const yarnCacheDir = join(process.cwd(), '.sandcastle', '.yarn-cache');
mkdirSync(yarnCacheDir, { recursive: true });

// Claude Code's per-project session store, bind-mounted into the agent container at
// /home/agent/.claude/projects so every transcript — including each sub-agent's
// <sessionId>/subagents/agent-*.jsonl — lands on the host AS IT IS WRITTEN.
//
// Sandcastle's own capture cannot cover a crash: `invokeAgent` throws before the
// "Capturing session" step ever runs, so a run killed by a provider limit left its
// sub-agent transcripts inside a container that is then torn down. That is exactly the
// run whose sub-agent behaviour you most want to read. A mount sidesteps the ordering
// entirely — there is nothing to copy out, because it was never only inside.
//
// Deliberately NOT the host's real ~/.claude/projects: sandcastle still captures to
// that store on the success path, and pointing both at one directory would have the
// capture copying a file onto itself.
const sessionsDir = join(process.cwd(), '.sandcastle', 'sessions');
mkdirSync(sessionsDir, { recursive: true });

// Graphify's structural graph, bind-mounted read-only into the agent container so
// CodeExplorer's `graphify` MCP server (declared in .mcp.json) has something to
// serve. `.mcp.json`'s args already expect `graphify-out/graph.json` relative to
// the worktree, and MountConfig resolves a relative sandboxPath from that same
// worktree root — so hostPath/sandboxPath of plain `'graphify-out'` lands exactly
// there with no MCP config change. Only the primary checkout ever refreshes this
// graph (`.husky/graphify-refresh.sh` exits early for any linked worktree), so
// what gets mounted into a sandcastle worktree is always the primary checkout's
// snapshot, never the slice's own in-progress state. See docs/graphify.md and #413.
//
// Conditional on purpose: sandcastle's mount validation requires hostPath to
// exist, and most contributors have never built a graph. An unconditional mount
// would turn a documented opt-in supplement into a hard dispatch requirement.
// Absent, no mount is added and CodeExplorer falls back to Glob/Grep as already
// documented in .github/agents/explore.agent.md.
const graphifyGraphPath = join(process.cwd(), 'graphify-out', 'graph.json');
const graphifyAvailable = existsSync(graphifyGraphPath);

/**
 * Best-effort provenance line for the mounted graphify graph, injected into the
 * slice prompt so a sub-agent that never opens docs/graphify.md still learns the
 * graph can be stale (#413 decision 3 — a prompt is the one channel a sub-agent
 * demonstrably reads; #396 showed the inverse for anything left only in a doc).
 *
 * Graphify records no commit sha of its own, so "built at" is approximated from
 * graph.json's mtime against history — valid because the graph is always a
 * same-checkout snapshot (see the mount comment above). The walk is pinned to
 * `baseRef`, not HEAD: the slice branch is cut from `baseRef`, so a commit found
 * there is an ancestor by construction. Left on HEAD, dispatching while the
 * primary checkout sits on an unrelated feature branch would resolve a sha off
 * that branch, fail the ancestry test, and degrade every prompt to the
 * unknown-staleness wording below.
 */
function graphifyProvenance(sliceBranch: string): string | null {
  if (!graphifyAvailable) return null;

  const builtAt = statSync(graphifyGraphPath).mtime;
  const sha = spawnSync(
    'git',
    ['log', '-1', `--before=${builtAt.toISOString()}`, '--format=%H', baseRef],
    { encoding: 'utf8', windowsHide: true },
  ).stdout.trim();
  if (!sha) return null;
  const shortSha = sha.slice(0, 12);

  const isAncestor =
    spawnSync('git', ['merge-base', '--is-ancestor', sha, sliceBranch], {
      encoding: 'utf8',
      windowsHide: true,
    }).status === 0;
  if (!isAncestor) {
    return (
      `A graphify graph is mounted at \`graphify-out/\` for the \`graphify\` MCP server, but its ` +
      `approximate build commit (\`${shortSha}\`, from graph.json's mtime) is not an ancestor of ` +
      `\`${sliceBranch}\` — treat its staleness as unknown and confirm any result against the actual file.`
    );
  }

  const behind = gitCmd(['rev-list', '--count', `${sha}..${sliceBranch}`]);
  return (
    `A graphify graph is mounted at \`graphify-out/\` for the \`graphify\` MCP server (see ` +
    `docs/graphify.md). Built at approx. \`${shortSha}\`, ${behind} commit(s) behind \`${sliceBranch}\` — ` +
    `files changed since are not in it. Confirm any graph result against the actual file.`
  );
}

// Env that makes every container use the bind-mounted global cache.
const YARN_CACHE_ENV = {
  YARN_ENABLE_GLOBAL_CACHE: 'true',
  YARN_GLOBAL_FOLDER: '/home/agent/.yarn-cache',
} as const;

// Run the gate container as the host user so bind-mounted files (worktree, cache)
// stay owned by the dispatcher. Matches the AGENT_UID/GID baked into the image by
// sandcastle (host UID/GID at build). undefined on Windows, but dispatch runs on
// Linux/WSL2/macOS where these are defined.
const HOST_UID = process.getuid?.() ?? 1000;
const HOST_GID = process.getgid?.() ?? 1000;

const worktreesDir = join(process.cwd(), '.sandcastle', 'worktrees');

// CI's `Prisma Migration Gate` job runs `prisma migrate deploy` and a drift
// check against a `postgres:16` service with trust auth and this database name
// (.github/workflows/ci.yml); the `Test` job itself carries no database (ADR
// 0094, ADR 0140, issue #1394). The gate reproduces that service when
// `backend:test` is in scope, so a database-backed suite fails here only when it
// would fail on the PR.
//
// Declared here, above `if (gateOnly)`: --gate-only reaches runGate during module
// evaluation, so a const declared further down is still in its temporal dead zone.
const GATE_DB_IMAGE = 'postgres:16';
const GATE_DB_NAME = 'myorganiser';
// Every gate database carries this label, so containers orphaned by a killed
// run can be found and removed (`docker rm -f $(docker ps -aq --filter label=…)`).
const GATE_DB_LABEL = 'sandcastle.gate-db=1';
// The same placeholder CI's non-database jobs pass: several backend modules build a
// PrismaClient at module scope, so a suite importing one throws without any value.
const GATE_PLACEHOLDER_DATABASE_URL = 'postgresql://localhost:5432/myorganiser';

// Same commands, same order, as CI's "Apply Prisma migrations and check schema
// drift" step. Runs inside the gate container after install.
const GATE_DB_PREPARE = [
  'cd apps/backend/src',
  'node ../../../node_modules/.bin/prisma migrate deploy --schema prisma/schema',
  'node ../../../node_modules/.bin/prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code',
  'cd /home/agent/workspace',
].join(' && ');

if (gateOnly) {
  if (integrationBranch === null) {
    fail(
      '--gate-only needs --prd: there is no feature branch to gate without one.',
    );
  }
  const ok = runFeatureGate(integrationBranch);
  console.log(
    ok
      ? `\n  gate: PASS on ${integrationBranch} against ${prdGateBase} — ${assemblySummary()}.`
      : `\n  gate: FAIL on ${integrationBranch}. Every slice is still integrated; ` +
          `nothing was discarded and nothing is pushed.`,
  );
  reportFeatureGate(integrationBranch, ok);
  process.exit(ok ? 0 : 1);
}

// The "dispatching" banner is deliberately NOT printed here: a --dry-run dispatches
// nothing, and a sweep may still be declined at the confirmation prompt. It is
// printed once the run is actually committed to, just below the preview block.

// ─── Model routing ────────────────────────────────────────────────────────────

type AgentKind = 'claude' | 'cursor' | 'copilot';

function modelFor(issue: Issue): string {
  const labels = issue.labels.map((l) => l.name);
  if (labels.includes('complexity:high'))
    return sandcastleModels.claudeByComplexity.high;
  if (labels.includes('complexity:medium'))
    return sandcastleModels.claudeByComplexity.medium;
  return sandcastleModels.claudeByComplexity.low;
}

function resolveAgentKind(): AgentKind {
  const raw = (agentFlag ?? process.env.SANDCASTLE_AGENT ?? 'claude').trim();
  if (raw === 'claude' || raw === 'cursor' || raw === 'copilot') {
    return raw;
  }

  fail(`Unknown agent "${raw}". Available: claude, cursor, copilot.`);
}

function resolveModel(issue: Issue, agentKind: AgentKind): string {
  const explicitModel = modelFlag ?? process.env.SANDCASTLE_MODEL;
  if (explicitModel) return explicitModel;

  switch (agentKind) {
    case 'claude':
      return process.env.SANDCASTLE_CLAUDE_MODEL ?? modelFor(issue);
    case 'cursor':
      return (
        process.env.SANDCASTLE_CURSOR_MODEL ?? sandcastleModels.cursorDefault
      );
    case 'copilot':
      return (
        process.env.SANDCASTLE_COPILOT_MODEL ?? sandcastleModels.copilotDefault
      );
  }
}

function buildAgent(agentKind: AgentKind, model: string) {
  switch (agentKind) {
    case 'claude':
      return claudeCode(model);
    case 'cursor':
      return cursor(model);
    case 'copilot':
      return copilot(model);
  }
}

function providerEnvironment(): Record<string, string> {
  // Exactly one Claude credential reaches the container — see resolveClaudeAuth.
  // On cursor/copilot runs claudeAuth is null and neither is forwarded.
  const claudeVariables =
    claudeAuth === 'subscription'
      ? ['CLAUDE_CODE_OAUTH_TOKEN']
      : claudeAuth === 'api'
        ? ['ANTHROPIC_API_KEY']
        : [];

  const variableNames = [
    ...claudeVariables,
    'CURSOR_API_KEY',
    'COPILOT_GITHUB_TOKEN',
    'GH_TOKEN',
    'GITHUB_TOKEN',
  ];

  return Object.fromEntries(
    variableNames.flatMap((variableName) => {
      const value = process.env[variableName];
      return value ? [[variableName, value]] : [];
    }),
  );
}

// Branch type is read off the issue's labels so the branch name says what the work
// does, not merely which issue it came from — see AGENTS.md "Branch naming". First
// match wins, so the more specific intent (a security bug is a fix, not a chore)
// must come first.
// Order is significant: issues carry several of these at once. `qa` and `research`
// rank last because they describe why work is tracked, not what it changes — #290
// is labelled tooling + maintenance + qa but is a code fix, so `tooling` must win.
const BRANCH_TYPE_BY_LABEL: ReadonlyArray<readonly [string, string]> = [
  ['bug', 'fix'],
  ['security', 'fix'],
  ['enhancement', 'feat'],
  ['documentation', 'docs'],
  ['tooling', 'chore'],
  ['maintenance', 'chore'],
  ['dependencies', 'chore'],
  ['research', 'docs'],
  ['qa', 'chore'],
];

/** Conventional-commit type for an issue's work branch. Defaults to `chore`. */
function branchTypeFor(issue: Issue): string {
  const labels = new Set(issue.labels.map((label) => label.name));
  for (const [label, type] of BRANCH_TYPE_BY_LABEL) {
    if (labels.has(label)) return type;
  }
  return 'chore';
}

/** Every branch prefix a non-PRD work branch can be created under. */
const WORK_BRANCH_TYPES = [
  ...new Set(BRANCH_TYPE_BY_LABEL.map(([, type]) => type)),
  // Legacy: standalone runs used a flat `issue/` prefix before AGENTS.md pinned
  // the convention. Kept so stale branches from those runs are still cleaned up.
  'issue',
];

function slugFor(issue: Issue): string {
  return issue.title
    .replace(/^\[Slice\]\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function sliceBranchFor(issue: Issue): string {
  // PRD slices keep `slice/`, and the prefix is load-bearing: it marks a branch that
  // fast-forwards into a feature branch and closes its issue on success. Keeping it
  // distinct from the work-branch types also preserves the guarantee that a
  // standalone re-run of an issue that later becomes a PRD slice (or vice versa)
  // can never collide on a branch, worktree, or gate path.
  return mode === 'prd'
    ? `slice/${issue.number}-${slugFor(issue)}`
    : `${branchTypeFor(issue)}/${issue.number}-${slugFor(issue)}`;
}

/**
 * Branches a previous run of this issue may have left behind.
 *
 * The type is derived from labels, so re-running an issue whose labels changed
 * produces a different branch name than last time — deleting only the currently
 * computed name would orphan the old branch and its worktree.
 */
function staleWorkBranchesFor(issue: Issue): string[] {
  if (mode === 'prd') return [];
  const current = sliceBranchFor(issue);
  const slug = slugFor(issue);
  return WORK_BRANCH_TYPES.map((type) => `${type}/${issue.number}-${slug}`)
    .filter((branch) => branch !== current)
    .filter((branch) => gitRefExists(branch));
}

// A `git worktree prune` inside the sandbox deletes the slice worktree's admin
// directory (its gitdir names a host path the container cannot see), leaving files
// git no longer recognises. Re-register before any git call in the directory, or
// the checkpoint capture and the resume rebuild both fail on "is not a working
// tree". See tools/scripts/lib/sandcastle-worktree-repair.ts.
function ensureWorktreeRegistered(
  issueNumber: number,
  worktreePath: string,
  branch: string,
): void {
  const repair = repairOrphanedWorktree({ worktreePath, branch });
  if (repair.repaired) {
    console.log(
      `  [#${issueNumber}] re-registered orphaned worktree ${worktreePath} on ${branch} ` +
        `(its git admin directory had been pruned).`,
    );
  } else if (repair.error) {
    console.error(
      `  [#${issueNumber}] worktree ${worktreePath} is orphaned and could not be ` +
        `re-registered: ${repair.error}. See docs/sandcastle/RUNBOOK.md — ` +
        `"An orphaned slice worktree".`,
    );
  }
}

// Sandcastle cleans up the worktree inside run(), with no hook in between, so an
// orphaned worktree makes run() reject AFTER the agent finished and the result is
// lost. When that is the only failure and the agent signalled completion, repair
// the worktree and carry on as a completed run rather than a crash (#1220). The
// session and per-iteration usage went with the rejected result, so the stand-in
// carries none; finalize, integration, and the outcome judgement read git and the
// log, which both survive.
async function finishedDespiteCleanup(
  issue: Issue,
  sliceBranch: string,
  pending: ReturnType<typeof run>,
): Promise<Awaited<ReturnType<typeof run>>> {
  try {
    return await pending;
  } catch (e) {
    const logFilePath = sliceLogPathFor(issue.number);
    if (
      !isCleanupOnlyFailure({
        errorText: String(e),
        logText: readRunLog(logFilePath, issue.number),
        completionPromise: COMPLETION_PROMISE,
      })
    ) {
      throw e;
    }
    const worktreePath = join(worktreesDir, sliceBranch.replace(/\//g, '-'));
    ensureWorktreeRegistered(issue.number, worktreePath, sliceBranch);
    console.log(
      `  [#${issue.number}] the agent finished; only sandcastle's worktree cleanup ` +
        `failed. Finalizing as a completed run.`,
    );
    const shas = (
      spawnSync(
        'git',
        ['rev-list', '--reverse', `${baseRef}..${sliceBranch}`],
        {
          encoding: 'utf8',
          windowsHide: true,
        },
      ).stdout || ''
    )
      .split('\n')
      .filter(Boolean);
    return {
      iterations: [],
      commits: shas.map((sha) => ({ sha })),
      branch: sliceBranch,
      logFilePath,
    } as unknown as Awaited<ReturnType<typeof run>>;
  }
}

// ─── Finalize the agent's local commit ─────────────────────────────────────────
// Agents run in a credential-less sandbox and only commit locally on their slice
// branch. Their commit lands on the local slice-branch ref (shared .git), so there
// is nothing to push. This just captures any stray uncommitted changes the agent
// left (formatting, generated files) and confirms the slice actually produced work.
function finalizeSliceBranch(issue: Issue, sliceBranch: string): boolean {
  if (!gitRefExists(sliceBranch)) {
    console.error(
      `  [#${issue.number}] local branch ${sliceBranch} not found — nothing to integrate.`,
    );
    return false;
  }

  // If the agent's worktree survived AND has uncommitted changes, capture them.
  // --no-verify skips host husky hooks; the gate is the real check.
  const worktreePath = join(worktreesDir, sliceBranch.replace(/\//g, '-'));
  ensureWorktreeRegistered(issue.number, worktreePath, sliceBranch);
  if (existsSync(worktreePath)) {
    const dirty = (
      spawnSync('git', ['-C', worktreePath, 'status', '--porcelain'], {
        encoding: 'utf8',
        windowsHide: true,
      }).stdout || ''
    ).trim();
    if (dirty) {
      spawnSync('git', ['-C', worktreePath, 'add', '-A'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      spawnSync(
        'git',
        [
          '-C',
          worktreePath,
          'commit',
          '--no-verify',
          '-m',
          `chore(slice): finalize #${issue.number} agent changes`,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
    }
  }

  // Nothing ahead of the base means the agent produced no work.
  const ahead = spawnSync(
    'git',
    ['rev-list', '--count', `${baseRef}..${sliceBranch}`],
    { encoding: 'utf8', windowsHide: true },
  );
  if ((ahead.stdout || '').trim() === '0') {
    console.error(
      `  [#${issue.number}] ${sliceBranch} has no commits beyond ${baseRef} — nothing to integrate.`,
    );
    return false;
  }
  return true;
}

// ─── Interrupted slices ─────────────────────────────────────────────
// An agent run that ends without a completion signal — a provider limit, a timeout,
// a container fault — leaves its work uncommitted in the preserved worktree, and the
// slice branch itself is force-deleted the next time this issue is dispatched. Commit
// that work as a Slice Checkpoint and TAG it: the tag keeps the commit reachable after
// `git branch -D`, so the existing gate-failure retry flow (delete the branch, run the
// slice again from a clean base) keeps working untouched. See ADR 0035; resuming from
// a checkpoint rather than merely surviving is PRD #401.

/**
 * Read the git facts the resume decision needs. Impure by nature — kept here rather
 * than in the decision library so the decision itself stays testable without git.
 */
function inspectSliceBranch(sliceBranch: string): {
  branchExists: boolean;
  commitsAhead: number;
  mergeBaseMatchesBase: boolean;
} {
  if (!gitRefExists(sliceBranch)) {
    return {
      branchExists: false,
      commitsAhead: 0,
      mergeBaseMatchesBase: false,
    };
  }

  const commitsAhead = Number.parseInt(
    (
      spawnSync('git', ['rev-list', '--count', `${baseRef}..${sliceBranch}`], {
        encoding: 'utf8',
        windowsHide: true,
      }).stdout || ''
    ).trim(),
    10,
  );

  const mergeBase = (
    spawnSync('git', ['merge-base', sliceBranch, baseRef], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || ''
  ).trim();
  const baseSha = (
    spawnSync('git', ['rev-parse', baseRef], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || ''
  ).trim();

  return {
    branchExists: true,
    commitsAhead,
    mergeBaseMatchesBase: mergeBase !== '' && mergeBase === baseSha,
  };
}

/** The checkpoint sitting on a slice branch, for the resume brief's inventory. */
function readSliceCheckpoint(
  sliceBranch: string,
): { sha: string; files: string[] } | undefined {
  const sha = (
    spawnSync('git', ['rev-parse', '--short', sliceBranch], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || ''
  ).trim();
  if (!sha) return undefined;

  const files = (
    spawnSync('git', ['diff', '--name-only', `${baseRef}..${sliceBranch}`], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || ''
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  return { sha, files };
}

type SliceCheckpoint = {
  readonly sha: string;
  readonly tag: string;
  readonly fileCount: number;
};

/**
 * The text of this run's slice log, for judging its outcome. Empty when no log
 * can be read, which judges as held: a run nobody can read is not a run anybody
 * can call finished.
 */
function readRunLog(
  logFilePath: string | undefined,
  issueNumber: number,
): string {
  const path = logFilePath ?? sliceLogPathFor(issueNumber);
  if (!path || !existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** Newest sandcastle log for this issue, or undefined when none was written. */
function sliceLogPathFor(issueNumber: number): string | undefined {
  const logsDir = join(process.cwd(), '.sandcastle', 'logs');
  if (!existsSync(logsDir)) return undefined;
  const suffix = `--${issueNumber}.log`;
  const candidates = readdirSync(logsDir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => join(logsDir, name))
    .filter((path) => existsSync(path));
  if (candidates.length === 0) return undefined;
  return candidates.sort(
    (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs,
  )[0];
}

/**
 * The thrown AgentError carries whatever was last on stderr, which is routinely a
 * trailing warning rather than the cause. Surface the log tail next to it instead of
 * classifying it — provider-specific limit matchers belong to PRD #401, and this
 * orchestrator runs claude, cursor, and copilot.
 */
function readSliceLogTail(
  issueNumber: number,
  lines = 15,
): { path: string; tail: string[] } | undefined {
  const logPath = sliceLogPathFor(issueNumber);
  if (!logPath) return undefined;
  let contents: string;
  try {
    contents = readFileSync(logPath, 'utf8');
  } catch {
    return undefined;
  }
  const tail = tailLines(contents, lines);
  if (tail.length === 0) return undefined;
  return { path: logPath, tail };
}

/**
 * What the previous run for this slice was, and what it said it did.
 *
 * The two cases look IDENTICAL to `decideSliceDisposition`, which reads only branch
 * existence, commits-ahead and merge-base — so #447 was told its cleanly committed,
 * fully reviewed work was an unchecked mid-kill checkpoint, and re-ran six pipelines
 * to find out otherwise. The tag is what separates them: only the crash path tags a
 * Slice Checkpoint. A normal commit carries no tag. See ADR 0044.
 */
function readPriorRun(
  issueNumber: number,
  sliceBranch: string,
): { kind: string; handoff: string[] } {
  const tag = `wip/${issueNumber}-checkpoint`;
  const tagged = (
    spawnSync('git', ['rev-parse', '--quiet', '--verify', `${tag}^{commit}`], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || ''
  ).trim();
  const head = (
    spawnSync('git', ['rev-parse', `${sliceBranch}^{commit}`], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || ''
  ).trim();

  const kind =
    tagged !== '' && tagged === head
      ? PRIOR_RUN_KINDS.interrupted
      : PRIOR_RUN_KINDS.gateFailure;

  let handoff: string[] = [];
  const logPath = sliceLogPathFor(issueNumber);
  if (logPath) {
    try {
      handoff = extractHandoff(readFileSync(logPath, 'utf8'));
    } catch {
      /* no log, no handoff — absent must read as "unknown", not "nothing ran" */
    }
  }
  return { kind, handoff };
}

/**
 * Append a handoff marker to this slice's log so the NEXT run can read it.
 *
 * The orchestrator's own observations (above all the gate verdict) belong in the
 * same stream as the agent's, because `extractHandoff` reads one carrier. Silent on
 * failure: a missing log must never take down a dispatch.
 */
function appendHandoffToSliceLog(issueNumber: number, entry: string): void {
  const logPath = sliceLogPathFor(issueNumber);
  if (!logPath) return;
  try {
    appendFileSync(logPath, `\n${HANDOFF_MARKER} ${entry}\n`);
  } catch {
    /* the log is a convenience, not a dependency */
  }
}

function formatCrashLogTail(
  log: { path: string; tail: string[] } | undefined,
): string | undefined {
  if (!log) return undefined;
  return `  log tail (${log.path}):\n${log.tail
    .map((line) => `    ${line}`)
    .join('\n')}`;
}

/**
 * Commit whatever the interrupted agent left behind onto its slice branch and tag it.
 * Returns the checkpoint, or undefined when there was nothing to preserve.
 *
 * --no-verify is deliberate: husky would lint and format half-finished code and
 * corrupt the very evidence being preserved. This mirrors the capture
 * finalizeSliceBranch performs on the success path.
 */
function preserveInterruptedSlice(
  issue: Issue,
  sliceBranch: string,
): SliceCheckpoint | undefined {
  if (!gitRefExists(sliceBranch)) return undefined;

  const worktreePath = join(worktreesDir, sliceBranch.replace(/\//g, '-'));
  ensureWorktreeRegistered(issue.number, worktreePath, sliceBranch);
  if (existsSync(worktreePath)) {
    const dirty = (
      spawnSync('git', ['-C', worktreePath, 'status', '--porcelain'], {
        encoding: 'utf8',
        windowsHide: true,
      }).stdout || ''
    ).trim();
    if (dirty) {
      spawnSync('git', ['-C', worktreePath, 'add', '-A'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const commit = spawnSync(
        'git',
        [
          '-C',
          worktreePath,
          'commit',
          '--no-verify',
          '-m',
          `wip(slice): checkpoint interrupted #${issue.number} agent run\n\n` +
            `The agent run ended without a completion signal and this work was left\n` +
            `uncommitted in the preserved worktree. NOT reviewed, NOT gated, NOT ready\n` +
            `to ship — files present here do not mean a Gated Pipeline ran.\n\n` +
            `Refs #${issue.number}`,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
      if (commit.status !== 0) {
        console.error(
          `  [#${issue.number}] could not commit the interrupted worktree:\n${commit.stderr}`,
        );
      }
    }
  }

  // Nothing ahead of the base means there is no work to protect.
  const ahead = (
    spawnSync('git', ['rev-list', '--count', `${baseRef}..${sliceBranch}`], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || ''
  ).trim();
  if (ahead === '' || ahead === '0') return undefined;

  const sha = (
    spawnSync('git', ['rev-parse', '--short', sliceBranch], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || ''
  ).trim();

  // -f so a later interruption of the same slice re-points the tag at the newer
  // checkpoint rather than failing and leaving the run without protection.
  const tag = `wip/${issue.number}-checkpoint`;
  spawnSync('git', ['tag', '-f', tag, sliceBranch], {
    encoding: 'utf8',
    windowsHide: true,
  });

  const fileCount = (
    spawnSync('git', ['diff', '--name-only', `${baseRef}..${sliceBranch}`], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || ''
  )
    .split('\n')
    .filter((line) => line.trim() !== '').length;

  return { sha, tag, fileCount };
}

// ─── Build gate ───────────────────────────────────────────────────────────────
// Before a slice is fast-forwarded into the LOCAL feature branch, verify it in a
// Docker container. WHERE it runs depends on the mode (ADR 0045):
//
//   PRD        — once, at the end, on the assembled feature branch against
//                origin/main. Slices integrate unconditionally; the gate reports
//                rather than blocks, because an unattended PRD that stops on slice
//                one delivers nothing at all.
//   standalone — per slice, fail-closed as before. The work branch IS the
//                deliverable, so there is no later gate to defer to.
//
// Disable entirely with SLICE_GATE=off.
//
// The default targets mirror what CI enforces on the eventual PR (`nx affected -t
// lint`, `nx affected -t test`, `nx build web|backend`), so a gate-green
// slice is not one that fails the moment it is pushed. `build` is what typechecks
// this repo — there is no `typecheck` target — and it is the step that catches a
// slice whose types do not compile against its consumers.

interface GateDatabase {
  network: string;
  container: string;
  url: string;
}

function dockerCmd(args: string[]) {
  return spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
}

/**
 * Start a throwaway Postgres on a private Docker network for one gate run.
 * Returns null (after cleaning up whatever it created) if it cannot be started
 * or does not accept TCP connections within a minute.
 */
function startGateDatabase(label: string): GateDatabase | null {
  // Short on purpose: the container name is the hostname in DATABASE_URL, and a
  // DNS label over 63 characters (a branch-derived name easily is) never resolves.
  const suffix = `${process.pid}-${Date.now().toString(36)}`;
  const db: GateDatabase = {
    network: `sandcastle-gate-${suffix}`,
    container: `sandcastle-gate-db-${suffix}`,
    url: '',
  };
  db.url = `postgresql://postgres@${db.container}:5432/${GATE_DB_NAME}`;

  const net = dockerCmd([
    'network',
    'create',
    '--label',
    GATE_DB_LABEL,
    db.network,
  ]);
  if (net.status !== 0) {
    console.error(
      `  [${label}] gate: could not create the database network.\n${net.stderr}`,
    );
    return null;
  }
  const pg = dockerCmd([
    'run',
    '-d',
    '--rm',
    '--name',
    db.container,
    '--network',
    db.network,
    '--label',
    GATE_DB_LABEL,
    '-e',
    'POSTGRES_USER=postgres',
    // Throwaway, unpublished, reachable only on its private network — as in CI.
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e',
    `POSTGRES_DB=${GATE_DB_NAME}`,
    GATE_DB_IMAGE,
  ]);
  if (pg.status !== 0) {
    console.error(
      `  [${label}] gate: could not start ${GATE_DB_IMAGE}.\n${pg.stderr}`,
    );
    stopGateDatabase(db);
    return null;
  }

  // Probe over TCP, not the default Unix socket: the image's init phase runs a
  // temporary server that answers on the socket only, then restarts.
  const tick = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = dockerCmd([
      'exec',
      db.container,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'postgres',
    ]);
    if (ready.status === 0) return db;
    Atomics.wait(tick, 0, 0, 1000);
  }
  console.error(
    `  [${label}] gate: ${GATE_DB_IMAGE} did not become ready within 60s.`,
  );
  stopGateDatabase(db);
  return null;
}

function stopGateDatabase(db: GateDatabase): void {
  dockerCmd(['rm', '-f', db.container]);
  dockerCmd(['network', 'rm', db.network]);
}

function runGate(
  label: string,
  base: string,
  head: string,
  handoffIssue?: number,
): boolean {
  if ((process.env.SLICE_GATE ?? '').toLowerCase() === 'off') {
    console.log(
      `  [${label}] gate disabled (SLICE_GATE=off) — integrating without verification.`,
    );
    return true;
  }

  const targets = (process.env.SLICE_GATE_TARGETS || 'lint test build').trim();
  const targetList = targets.split(/[\s,]+/).filter(Boolean);

  // Two scopes, because the targets have different blast radii.
  //
  // `lint` is per-file: an upstream change cannot introduce lint errors in an
  // unchanged downstream file, so it runs only on projects whose OWN files changed.
  //
  // Everything else (`test`, `build`) is cross-project: a lib change routinely
  // breaks an unchanged consumer's compile or suite, so it runs on the affected
  // set — changed projects plus their transitive dependents.
  const perFileTargets = targetList.filter((t) => t === 'lint');
  const crossProjectTargets = targetList.filter((t) => t !== 'lint');

  const changed = changedProjects(base, head);
  if (changed.length === 0) {
    console.log(`  [${label}] gate: no project files changed — pass.`);
    return true;
  }

  let affected: string[] = [];
  if (crossProjectTargets.length > 0) {
    const resolved = affectedProjects(base, head);
    if (resolved === null) {
      console.error(
        `  [${label}] gate: could not resolve the affected project graph for ` +
          `'${crossProjectTargets.join(' ')}' — failing closed.`,
      );
      return false;
    }
    affected = resolved;
  }

  // `test` runs as its own invocation so it can carry a worker cap that the build
  // executors must not see.
  //
  // Jest sizes its worker pool from the CPU count visible in the container, which is
  // the host's — 12 on a typical dev Mac — while the Docker VM's memory is a fraction
  // of the host's. The default pool exhausts it and workers come back as
  // "terminated by another process: signal=SIGKILL", which reads like a test failure
  // and is not one. CI never hits this: its runner has 4 CPUs, so jest picks 3.
  //
  // Capping is also faster, not a trade: on this repo the backend suite goes from 7
  // SIGKILLed suites in 312s to 30 passing suites in 27s, because nothing thrashes.
  const testTargets = crossProjectTargets.filter((t) => t === 'test');
  const buildTargets = crossProjectTargets.filter((t) => t !== 'test');
  const jestWorkers = process.env.SLICE_GATE_JEST_WORKERS || '2';

  // Each entry becomes one `nx run-many` invocation inside the container.
  const runs: Array<{ targets: string[]; projects: string[]; args: string[] }> =
    [
      { targets: perFileTargets, projects: changed, args: [] },
      {
        targets: testTargets,
        projects: affected,
        args: [`--maxWorkers=${jestWorkers}`],
      },
      { targets: buildTargets, projects: affected, args: [] },
    ].filter((run) => run.targets.length > 0 && run.projects.length > 0);

  if (runs.length === 0) {
    console.log(
      `  [${label}] gate: no targets resolved to any project — pass.`,
    );
    return true;
  }

  // Gate in a DEDICATED detached worktree at the local slice commit. Detached + a
  // separate path means it never holds the slice branch checked out and it is
  // independent of sandcastle's own worktree lifecycle (which may already have
  // removed the agent's worktree).
  const gateName = head.replace(/\//g, '-');
  const gateRoot = join(process.cwd(), '.sandcastle', 'gate');
  const gatePath = join(gateRoot, gateName);
  mkdirSync(gateRoot, { recursive: true });
  spawnSync('git', ['worktree', 'prune'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (existsSync(gatePath)) {
    spawnSync('git', ['worktree', 'remove', '--force', gatePath], {
      encoding: 'utf8',
      windowsHide: true,
    });
  }
  const add = spawnSync(
    'git',
    ['worktree', 'add', '--detach', gatePath, head],
    { encoding: 'utf8', windowsHide: true },
  );
  if (add.status !== 0) {
    console.error(
      `  [${label}] gate: could not create gate worktree — failing closed.\n${add.stderr}`,
    );
    return false;
  }

  try {
    // Validate this slice INSIDE the Linux container (cross-platform: WSL2, native
    // Linux, and macOS hosts all work). Install the slice's EXACT tree in-container
    // — so the gate validates lock-changing slices correctly, with binaries matching
    // the container — then run nx. Shares the bind-mounted Yarn global cache, so the
    // install is incremental. Fail closed on any failure.
    for (const run of runs) {
      console.log(
        `  [${label}] gate: will run '${run.targets.join(' ')}' on ${run.projects.join(', ')}`,
      );
    }
    console.log(`  [${label}] gate: installing + running ...`);
    // Database, decided per run. An operator-supplied SLICE_GATE_DATABASE_URL wins
    // and is used as-is. Otherwise, when backend:test is in scope, the gate brings
    // up the same Postgres CI's `Prisma Migration Gate` job has, and runs
    // GATE_DB_PREPARE against it the same way that job does; with no backend
    // tests, nothing connects and the placeholder is enough.
    const testProjects = runs
      .filter((run) => run.targets.includes('test'))
      .flatMap((run) => run.projects);
    const operatorDatabaseUrl = process.env.SLICE_GATE_DATABASE_URL;
    let database: GateDatabase | null = null;
    if (!operatorDatabaseUrl && testProjects.includes('backend')) {
      console.log(
        `  [${label}] gate: backend:test in scope — starting a throwaway ${GATE_DB_IMAGE} (as CI's Prisma Migration Gate job) ...`,
      );
      database = startGateDatabase(label);
      if (database === null) {
        console.error(
          `  [${label}] gate: no database for backend:test — failing closed. ` +
            'This is an environment failure, not a verdict on the code.',
        );
        return false;
      }
    }
    const gateDatabaseUrl =
      operatorDatabaseUrl || database?.url || GATE_PLACEHOLDER_DATABASE_URL;
    try {
      const gate = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          ...(database ? ['--network', database.network] : []),
          '--user',
          `${HOST_UID}:${HOST_GID}`,
          '-e',
          'HOME=/home/agent',
          '-e',
          // The gate database when one was started; otherwise the placeholder that
          // keeps module-scope PrismaClient construction from throwing on import.
          `DATABASE_URL=${gateDatabaseUrl}`,
          '-e',
          'NX_DAEMON=false',
          '-e',
          'NX_ISOLATE_PLUGINS=false',
          '-e',
          'NX_SKIP_NX_CACHE=true',
          '-e',
          'NX_CACHE_DIRECTORY=/home/agent/workspace/.nx/cache',
          '-e',
          'NX_WORKSPACE_DATA_DIRECTORY=/home/agent/workspace/.nx/workspace-data',
          '-e',
          `YARN_ENABLE_GLOBAL_CACHE=${YARN_CACHE_ENV.YARN_ENABLE_GLOBAL_CACHE}`,
          '-e',
          `YARN_GLOBAL_FOLDER=${YARN_CACHE_ENV.YARN_GLOBAL_FOLDER}`,
          '-v',
          `${gatePath}:/home/agent/workspace`,
          '-v',
          `${yarnCacheDir}:/home/agent/.yarn-cache`,
          '--entrypoint',
          '/bin/bash',
          SANDBOX_IMAGE,
          '-c',
          [
            'cd /home/agent/workspace',
            'corepack yarn install --immutable',
            ...(database ? [GATE_DB_PREPARE] : []),
            ...runs.map(
              (run) =>
                `node node_modules/.bin/nx run-many -t ${run.targets.join(' ')} --projects=${run.projects.join(',')} --skip-nx-cache${run.args.map((a) => ` ${a}`).join('')}`,
            ),
          ].join(' && '),
        ],
        {
          encoding: 'utf8',
          stdio: 'inherit',
          windowsHide: true,
          // Install + lint + test + a Next.js production build. The 30-minute budget
          // this carried when the gate ran lint alone is not enough once `build` is in.
          timeout: 3600000,
        },
      );

      const ok = gate.status === 0;
      console.log(`  [${label}] gate: ${ok ? 'PASS' : 'FAIL'}.`);
      // Mirror the verdict into the slice log as a handoff marker. A gate failure is
      // the one thing about the previous run that git cannot show the next agent, and
      // without it a resumed agent cannot tell "my code was rejected" from "I was
      // killed mid-thought" — so it re-runs every pipeline. See ADR 0044.
      if (handoffIssue !== undefined)
        appendHandoffToSliceLog(
          handoffIssue,
          ok
            ? `gate PASS (${targets})`
            : `gate FAILED (${targets}) — the agent's work was committed; the HOST GATE rejected it`,
        );
      return ok;
    } finally {
      if (database) stopGateDatabase(database);
    }
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', gatePath], {
      encoding: 'utf8',
      windowsHide: true,
    });
  }
}

/**
 * Gate ONE slice against its base. Retained for standalone runs, where the work
 * branch is the deliverable and there is no feature branch to gate later.
 */
function runSliceGate(issue: Issue, sliceBranch: string): boolean {
  return runGate(`#${issue.number}`, baseRef, sliceBranch, issue.number);
}

/**
 * Gate the whole PRD once, on the integrated feature branch, against the ref the
 * eventual PR will target.
 *
 * This is the gate that matters. A per-slice gate can only see one slice against
 * the head it was cut from, so two slices that break EACH OTHER pass individually
 * and fail on the PR — while costing one container install per slice. Gating
 * `origin/main...feat/<slug>` runs exactly what CI will run, once. See ADR 0045.
 */
function runFeatureGate(featureBranch: string): boolean {
  console.log(
    `\n  gate: running once on ${featureBranch} against ${prdGateBase} ` +
      `(what CI will run on the PR) ...`,
  );
  return runGate(featureBranch, prdGateBase, featureBranch);
}

// ─── Integrate a slice into the local feature branch (fast-forward) ────────────
// Slices run serially, each branched off the current feature head, so the slice is
// always a pure descendant of the feature branch — a fast-forward, no merge commit,
// no conflicts. We advance the (un-checked-out) feature ref with `git branch -f`.
// Nothing is pushed. Fails closed if the slice is somehow not a descendant.
//
// Standalone runs never reach this: with no PRD there is no integration target, so
// the work branch is left exactly as the agent committed it.
function integrateSlice(
  issue: Issue,
  sliceBranch: string,
  featureBranch: string,
): boolean {
  const isDescendant =
    spawnSync(
      'git',
      ['merge-base', '--is-ancestor', featureBranch, sliceBranch],
      { encoding: 'utf8', windowsHide: true },
    ).status === 0;
  if (!isDescendant) {
    console.error(
      `  [#${issue.number}] integrate: ${sliceBranch} is not a fast-forward of ${featureBranch} — failing closed (resolve by hand).`,
    );
    return false;
  }

  const findCheckedOutWorktreeForBranch = (branch: string): string | null => {
    const wt = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (wt.status !== 0 || !wt.stdout.trim()) return null;

    let worktreePath: string | null = null;
    for (const line of wt.stdout.split('\n')) {
      if (!line.trim()) {
        worktreePath = null;
        continue;
      }
      if (line.startsWith('worktree ')) {
        worktreePath = line.slice('worktree '.length).trim();
        continue;
      }
      if (
        line === `branch refs/heads/${branch}` &&
        typeof worktreePath === 'string'
      ) {
        return worktreePath;
      }
    }
    return null;
  };

  const mergeInCheckedOutWorktree = (): boolean => {
    const worktreePath = findCheckedOutWorktreeForBranch(featureBranch);
    if (!worktreePath) return false;

    const ffMerge = spawnSync(
      'git',
      ['-C', worktreePath, 'merge', '--ff-only', sliceBranch],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );

    if (ffMerge.status !== 0) {
      console.error(
        `  [#${issue.number}] integrate: failed to fast-forward ${featureBranch} in checked-out worktree ${worktreePath}.\n${ffMerge.stderr}`,
      );
      return false;
    }

    console.log(
      `  [#${issue.number}] integrated into local ${featureBranch} (fast-forward in checked-out worktree).`,
    );
    return true;
  };

  const ff = spawnSync('git', ['branch', '-f', featureBranch, sliceBranch], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (ff.status !== 0) {
    if (ff.stderr.includes('cannot force update the branch')) {
      return mergeInCheckedOutWorktree();
    }
    console.error(
      `  [#${issue.number}] integrate: failed to advance ${featureBranch}.\n${ff.stderr}`,
    );
    return false;
  }
  console.log(
    `  [#${issue.number}] integrated into local ${featureBranch} (fast-forward).`,
  );
  return true;
}

function resolveGate(issue: Issue): 'mechanical' | 'standard' | 'full' {
  const labels = issue.labels.map((l) => l.name);
  if (labels.includes('gate:mechanical')) return 'mechanical';
  if (labels.includes('gate:full')) return 'full';
  return 'standard';
}

function buildGateInstructions(
  gate: 'mechanical' | 'standard' | 'full',
): string[] {
  const common = [
    `- Quality gate for this slice: \`gate:${gate}\` (ADR 0012 / \`.claude/checklist.md\`).`,
    `- Prefer short specialist reports (\`PASS|FAIL|ESCALATE\` + ≤5 bullets).`,
    `- Gated Pipeline reject-cycles: max 2 (ComponentReviewer and TestReviewer), then escalate with a diagnosis (ADR 0017).`,
    `- Hitting the cap, a repeated FAIL, or a static/reviewer PASS then Runner/tsc/eslint FAIL is a Pipeline Incident — comment \`## Pipeline Incident\` on the Slice Issue.`,
    // Phrased as an imperative with a placement, not as a rate limit. The earlier
    // wording ("runs once per Slice ... not after every specialist hop") described
    // frequency without ever telling the agent to run it, and was satisfiable by
    // never invoking it at all — which is what happened.
    `- REQUIRED: once your deterministic checks (jest/tsc/eslint) are green and BEFORE your final commit, invoke the \`/code-review\` Skill exactly once for this Slice.`,
    `- Act on its findings, then re-run the focused checks. Run it once per Slice — not after every specialist hop.`,
  ];

  if (gate === 'mechanical') {
    return [
      ...common,
      `- Mechanical path: main agent may edit directly (fixture/type retarget, rename, dead delete, selector-only E2E, verify-already-done).`,
      `- Do NOT run TestScaffold → TestReviewer → TestRunner or ComponentBuilder → ComponentReviewer for mechanical work.`,
      `- Still run focused deterministic checks (jest/tsc/eslint on touched files).`,
    ];
  }

  if (gate === 'full') {
    return [
      ...common,
      `- Full path: follow mandatory specialist pipelines in CLAUDE.md for behavioral tests, stories, and components.`,
      `- E2E: E2EPlanner → TestScaffold → TestReviewer (structural only); never execute Playwright in this sandbox.`,
    ];
  }

  return [
    ...common,
    `- Standard path: one specialist hop for the changed artifact type (not every pipeline by default).`,
    `- Follow CLAUDE.md / \`.claude/checklist.md\` for which agent chain applies.`,
    `- Skip E2EPlanner only for selector-only E2E edits when the flow matrix is unchanged.`,
  ];
}

/**
 * Read what an issue's comments add to its brief: the latest triage brief and
 * the maintainer notes, both from trusted authors only (`issue-comments.ts`).
 *
 * Fetched here, per dispatched slice, rather than added to the issue LIST queries:
 * those pull up to 200 issues and would carry every comment on all of them for the
 * sake of the handful actually being run.
 *
 * A failure to read comments must not stop a dispatch — the issue body is still a
 * brief — so this degrades to "no brief, no notes" and says so.
 */
function readIssueAmendments(issueNumber: number): {
  triageBrief: string | null;
  maintainerNotes: string[];
} {
  try {
    const { comments } = ghJson<{ comments?: IssueComment[] }>([
      'issue',
      'view',
      String(issueNumber),
      '--repo',
      REPO,
      '--json',
      'comments',
    ]);
    return {
      triageBrief: latestTriageBrief(comments),
      maintainerNotes: extractMaintainerNotes(comments),
    };
  } catch {
    console.warn(
      `  [#${issueNumber}] could not read issue comments; dispatching on the issue body alone.`,
    );
    return { triageBrief: null, maintainerNotes: [] };
  }
}

/**
 * The PRD a slice was cut from, for the brief.
 *
 * The sandbox has no `gh` credentials, so a slice that says "see #908" sends the
 * agent to a page it cannot open. Mobile v1's PRD stated the cyan active tab,
 * the Android ripple, "Nothing is saved while offline", and the approved unlock
 * copy in plain text; none of it reached a slice, and all of it drifted (ADR
 * 0111). Read here, on the host, and carried in the prompt.
 *
 * Like the maintainer notes, a failure to read it degrades to "no PRD" and says
 * so: the slice body is still a complete brief.
 */
function readParentPrd(
  issue: Issue,
): { number: number; title: string; body: string } | undefined {
  const match = issue.body?.match(/^\s*PRD:\s*#(\d+)/m);
  if (!match) return undefined;
  const number = Number(match[1]);
  try {
    const prd = ghJson<{ title?: string; body?: string }>([
      'issue',
      'view',
      String(number),
      '--repo',
      REPO,
      '--json',
      'title,body',
    ]);
    return { number, title: prd.title ?? '', body: prd.body ?? '' };
  } catch {
    console.warn(
      `  [#${issue.number}] could not read PRD #${number}; dispatching without it.`,
    );
    return undefined;
  }
}

function buildPrompt(
  issue: Issue,
  sliceBranch: string,
  parentPrd?: { number: number; title: string; body: string },
): string {
  const gate = resolveGate(issue);
  const graphifyNote = graphifyProvenance(sliceBranch);
  const attributionNote = fixAttributionInstruction(sliceBranch);
  return [
    `You are implementing GitHub Issue #${issue.number}: ${issue.title}`,
    ``,
    `## Issue`,
    ``,
    issue.body,
    ``,
    ...(parentPrd
      ? [
          `## Parent PRD #${parentPrd.number}: ${parentPrd.title}`,
          ``,
          `The PRD this slice was cut from, read on the host because this sandbox cannot open GitHub. It is background, not scope: build the issue above, and use this for the decisions, copy, and constraints the issue relies on.`,
          ``,
          parentPrd.body,
          ``,
        ]
      : []),
    `## Instructions`,
    ``,
    `- Dependencies are ALREADY installed in this sandbox before you start (a setup hook runs \`corepack yarn install --immutable\`). Do NOT run \`yarn install\` yourself.`,
    `- Read CLAUDE.md, CONTEXT.md, and TECH_STACK.md before making any changes.`,
    ...(graphifyNote ? [`- ${graphifyNote}`] : []),
    `- Implement this vertical slice end-to-end (schema → API → UI → tests where applicable).`,
    `- Your working branch is \`${sliceBranch}\` (based on \`${baseRef}\`). Do not switch branches.`,
    // Slice #1207 pruned its own worktree's admin directory from inside the
    // sandbox and crashed at the finish line. The image's git shim refuses it too.
    `- Never run \`git worktree prune\`. Every worktree's admin entry names a host path this sandbox cannot see, so prune deletes your own worktree's registration (and the host's other worktrees') while leaving the files. A worktree you add yourself may be removed with \`git worktree remove <path>\`; leave the rest to the orchestrator.`,
    ...buildGateInstructions(gate),
    // Naming only the runner here left the agent to hand-write the message; the
    // Commit sub-agent was never invoked. Name the drafting hop explicitly.
    `- Commit via the \`commit-change-workflow\` Skill: stage the intended paths, have the \`Commit\` sub-agent draft the Conventional Commit message from the STAGED diff, write it to a file, then run \`corepack yarn ai:commit --message-file <path>\`. Do not hand-write the commit message and do not run \`git commit\` directly.`,
    `- Take the commit type from what the work does (an issue labelled \`bug\` is \`fix\`, not \`feat\`).`,
    // The branch name carries #${issue.number} today, but a branch is renamed and
    // a commit is not. The reference in the message is what survives into the
    // feature branch, where the branch name carries nothing — ADR 0076.
    `- End the commit message body with \`Closes #${issue.number}\` on its own line, so the commit carries the issue even after it is integrated into a branch whose name does not.`,
    ...(attributionNote ? [`- ${attributionNote}`] : []),
    `- Do NOT push and do NOT open a PR — this sandbox has no credentials. Just commit locally on your branch; leave nothing uncommitted. The orchestrator integrates your branch into the feature branch on the host.`,
    `- Do NOT output the completion promise until ALL of these hold: deterministic checks green; \`/code-review\` run once and each finding either fixed or listed as ${OUTSTANDING_MARKER} (see below); work committed through the \`Commit\` sub-agent + \`ai:commit\`; working tree clean.`,
    `- When all of the above hold, output ${COMPLETION_PROMISE}.`,
    ``,
    `## Design`,
    ``,
    // ADR 0110 / 0111: Mobile v1's slices pointed at a private canvas link the
    // sandbox could not open, and eight of ten agents built without ever saying so.
    `- An approved design is committed under \`docs/design/\` (ADR 0110). If this issue or its PRD names a design there, that folder is the design: read the artboards this slice covers before building — each is an HTML file with every size, colour, and string written inline — and match their layout, copy, and states. The Foundation artboards apply to every screen.`,
    `- You cannot open links to hosted designs or private pages (claude.ai artifacts, Figma, Google Docs) or GitHub issues from this sandbox. Never write that something matches a design or document you did not read. If the design this slice builds to exists only as such a link, list that as ${OUTSTANDING_MARKER}.`,
    `- Where this issue, its PRD, and the committed design disagree, build what this issue says and list the disagreement as ${OUTSTANDING_MARKER} for a person to settle.`,
    `- This sandbox cannot build native iOS or Android code, run the app, or show a screen. An acceptance criterion that needs a device or a visual check is not met here: list it as ${OUTSTANDING_MARKER}.`,
    ``,
    `## Outcome (required)`,
    ``,
    `Before ${COMPLETION_PROMISE}, print one line per item that is not done or could not be verified, each starting \`${OUTSTANDING_MARKER}\`:`,
    ``,
    `  ${OUTSTANDING_MARKER} blocking /code-review finding not fixed — <what, and why>`,
    `  ${OUTSTANDING_MARKER} acceptance criterion not delivered — <which>`,
    `  ${OUTSTANDING_MARKER} needs a device — <which criterion or behaviour>`,
    `  ${OUTSTANDING_MARKER} could not read <source> — <what was assumed instead>`,
    ``,
    `When there is nothing, print exactly \`${OUTSTANDING_MARKER} none\` on its own line, with no explanation after it: your evidence belongs in the handoff markers. Never write "none" followed by an exception ("none, but …", "none — except …"); that exception is an item and gets its own line. The orchestrator closes this slice only when there are none; otherwise it integrates your work and hands the slice to a person with your list. An honest list is not a failure. A list with an item missing is.`,
    ``,
    `## Handoff markers (required)`,
    ``,
    // Written as each hop LANDS, not summarised at the end: a quota kill stops the
    // agent mid-thought, so an end-of-run summary is missing from exactly the run a
    // resume needs it from. See ADR 0044.
    `Print ONE line the moment each step completes, starting with \`${HANDOFF_MARKER}\`:`,
    ``,
    `  ${HANDOFF_MARKER} ComponentBuilder -> ComponentReviewer PASS`,
    `  ${HANDOFF_MARKER} TestScaffold -> TestReviewer APPROVED -> TestRunner 38 passed`,
    `  ${HANDOFF_MARKER} /code-review PASS (2 findings addressed)`,
    `  ${HANDOFF_MARKER} committed <sha> via Commit sub-agent`,
    ``,
    `Print each one AS IT HAPPENS — never batch them at the end. If this run is`,
    `interrupted, these lines are the only record of what already ran, and the next`,
    `agent re-does every step they do not cover.`,
    ``,
    `## Running tests in this sandbox`,
    ``,
    `Do NOT use \`yarn nx run ... test\`, \`corepack yarn nx\`, or any Nx wrapper to run tests.`,
    `Nx adds overhead and can appear hung when the suite takes longer than expected.`,
    `Use this command directly, substituting the actual lib path:`,
    ``,
    `  node node_modules/.bin/jest \\`,
    `    --config=<libpath>/jest.config.ts \\`,
    `    --no-coverage \\`,
    `    --forceExit \\`,
    `    --passWithNoTests \\`,
    `    --testPathIgnorePatterns='\\.integration\\.spec\\.'`,
    ``,
    `Example: \`node node_modules/.bin/jest --config=libs/web/pages/groceries/jest.config.ts --no-coverage --forceExit --passWithNoTests --testPathIgnorePatterns='\\.integration\\.spec\\.'\``,
    ``,
    `Flag reference:`,
    `- \`--no-coverage\`                    removes instrumentation overhead`,
    `- \`--forceExit\`                       prevents open-handle hangs after tests complete`,
    `- \`--passWithNoTests\`                 avoids a non-zero exit when no files match`,
    `- \`--testPathIgnorePatterns\`          skips \`*.integration.spec.*\` files — these need CI resources, not the sandbox`,
    ``,
    `Run synchronously — do not background the process or poll temp files.`,
    `Use a Bash timeout of at least 600 s; a full lib suite takes 5–8 min in Docker.`,
    `To run a subset, append \`--testPathPattern='<dir or filename fragment>'\`.`,
  ].join('\n');
}

// ─── Dispatch slices one by one ───────────────────────────────────────────────

type SliceResult = {
  issue: Issue;
  sliceBranch: string;
  commits: number;
  merged: boolean;
  reason: string;
};

function logRunUsage(
  issueNumber: number,
  agentKind: AgentKind,
  model: string,
  result: Awaited<ReturnType<typeof run>>,
): void {
  const usageDir = join(process.cwd(), '.sandcastle', 'usage');
  const usageFile = join(usageDir, 'agent-usage.jsonl');
  const writeUsageRecord = (record: Record<string, unknown>): void => {
    mkdirSync(usageDir, { recursive: true });
    appendFileSync(
      usageFile,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        prdNumber,
        issueNumber,
        agentKind,
        model,
        ...record,
      })}\n`,
    );
  };
  const writeLog = (message: string): void => {
    console.log(message);
    if (result.logFilePath) {
      appendFileSync(result.logFilePath, `\n${message}\n`);
    }
  };

  const usage = result.iterations.flatMap((iteration, index) =>
    iteration.usage ? [{ index, ...iteration.usage }] : [],
  );

  if (usage.length === 0) {
    writeUsageRecord({
      available: false,
      iterations: result.iterations.length,
      telemetryIterations: 0,
    });
    writeLog(
      `  [#${issueNumber}] ${agentKind}:${model} usage unavailable (the provider did not return token telemetry).`,
    );
    return;
  }

  const totals = usage.reduce(
    (total, iterationUsage) => ({
      inputTokens: total.inputTokens + iterationUsage.inputTokens,
      cacheCreationInputTokens:
        total.cacheCreationInputTokens +
        iterationUsage.cacheCreationInputTokens,
      cacheReadInputTokens:
        total.cacheReadInputTokens + iterationUsage.cacheReadInputTokens,
      outputTokens: total.outputTokens + iterationUsage.outputTokens,
    }),
    {
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
    },
  );

  writeUsageRecord({
    available: true,
    iterations: result.iterations.length,
    telemetryIterations: usage.length,
    iterationUsage: usage,
    ...totals,
  });
  writeLog(
    `  [#${issueNumber}] ${agentKind}:${model} tokens (sum of each iteration's ` +
      `final-turn snapshot — NOT a true run total; see IterationUsage in sandcastle) — ` +
      `input ${formatTokens(totals.inputTokens)}, ` +
      `cache-write ${formatTokens(totals.cacheCreationInputTokens)}, ` +
      `cache-read ${formatTokens(totals.cacheReadInputTokens)}, ` +
      `output ${formatTokens(totals.outputTokens)}.`,
  );
}

// ─── Sub-agent traces (--trace-subagents) ──────────────────────────────────────
// Sandcastle 0.12.0's Claude Code provider captures every sub-agent transcript to the
// host automatically and unconditionally — RunResult.iterations[].sessionFilePath
// already points at the captured main session, and its sibling
// <sessionId>/subagents/agent-*.jsonl files are captured the same way, with no flag
// of ours involved. This function does not create that data; it only relocates and
// summarizes what sandcastle already wrote, into a stable path under version control
// convention. See docs/adr/0036 and the spike recorded on issue #411.
function captureSubagentTraces(
  issue: Issue,
  result: Awaited<ReturnType<typeof run>>,
): void {
  if (!traceSubagents) return;

  const destDir = join(
    process.cwd(),
    '.sandcastle',
    'logs',
    'subagents',
    String(issue.number),
  );
  const multiIteration = result.iterations.length > 1;

  const summaries: Array<
    ReturnType<typeof parseSubagentTranscript> & { fileName: string }
  > = [];

  result.iterations.forEach((iteration, iterationIndex) => {
    if (!iteration.sessionId || !iteration.sessionFilePath) return;

    const subagentsDir = join(
      dirname(iteration.sessionFilePath),
      iteration.sessionId,
      'subagents',
    );
    if (!existsSync(subagentsDir)) return;

    const files = readdirSync(subagentsDir).filter(
      (name) => name.startsWith('agent-') && name.endsWith('.jsonl'),
    );
    if (files.length === 0) return;

    mkdirSync(destDir, { recursive: true });
    for (const fileName of files) {
      const jsonl = readFileSync(join(subagentsDir, fileName), 'utf8');
      const summary = parseSubagentTranscript(jsonl);
      const destFileName = multiIteration
        ? `iteration-${iterationIndex}--${fileName}`
        : fileName;
      writeFileSync(join(destDir, destFileName), jsonl);
      summaries.push({ ...summary, fileName: destFileName });
    }
  });

  if (summaries.length === 0) return;

  writeFileSync(
    join(destDir, 'index.md'),
    formatSubagentIndex(summaries, {
      issueNumber: issue.number,
      sliceBranch: sliceBranchFor(issue),
    }),
  );
  console.log(
    `  [#${issue.number}] traced ${summaries.length} sub-agent invocation(s) → ${destDir}`,
  );
}

/**
 * Recover sub-agent transcripts for a run that CRASHED.
 *
 * The success path reads `RunResult.iterations[].sessionFilePath`. A crash has no
 * result — `run()` threw — so there is no session id to look up, and sandcastle never
 * reached its capture step either. What there is: the bind-mounted session store, into
 * which Claude Code wrote every transcript live.
 *
 * Sessions are selected by mtime against the moment this run started rather than by id.
 * The store is per-repo and dispatch is one slice at a time, so anything written after
 * that instant belongs to the run that just died. A stale directory from an earlier
 * slice cannot qualify, and the worst case is recovering nothing rather than the wrong
 * thing.
 */
function recoverSubagentTracesAfterCrash(
  issue: Issue,
  runStartedAt: Date,
): void {
  if (!traceSubagents) return;

  const destDir = join(
    process.cwd(),
    '.sandcastle',
    'logs',
    'subagents',
    String(issue.number),
  );

  const summaries: Array<
    ReturnType<typeof parseSubagentTranscript> & { fileName: string }
  > = [];

  const collectFrom = (subagentsDir: string): void => {
    if (!existsSync(subagentsDir)) return;
    for (const fileName of readdirSync(subagentsDir)) {
      if (!fileName.startsWith('agent-') || !fileName.endsWith('.jsonl')) {
        continue;
      }
      const filePath = join(subagentsDir, fileName);
      if (statSync(filePath).mtime < runStartedAt) continue;

      const jsonl = readFileSync(filePath, 'utf8');
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, fileName), jsonl);
      summaries.push({ ...parseSubagentTranscript(jsonl), fileName });
    }
  };

  // <sessionsDir>/<encodedProjectPath>/<sessionId>/subagents/agent-*.jsonl — the
  // encoding is sandcastle's business, so both levels are walked rather than derived.
  const walk = (dir: string, depth: number): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      if (entry.name === 'subagents') collectFrom(child);
      else if (depth > 0) walk(child, depth - 1);
    }
  };

  try {
    walk(sessionsDir, 2);
  } catch (error) {
    console.warn(
      `  [#${issue.number}] could not recover sub-agent traces: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  if (summaries.length === 0) return;

  writeFileSync(
    join(destDir, 'index.md'),
    formatSubagentIndex(summaries, {
      issueNumber: issue.number,
      sliceBranch: sliceBranchFor(issue),
    }),
  );
  console.log(
    `  [#${issue.number}] recovered ${summaries.length} sub-agent transcript(s) from the crashed run → ${destDir}`,
  );
}

// ─── Preview and confirmation ─────────────────────────────────────────────────
// The plan is fully resolved by this point but nothing has been created yet, so
// this is the last moment a run can be inspected or abandoned for free.

function printPlanPreview(): void {
  console.log('Planned work:\n');
  for (const issue of slices) {
    const model = resolveModel(issue, agentKind);
    console.log(`  #${issue.number}  ${issue.title}`);
    console.log(
      `      branch ${sliceBranchFor(issue)}  ·  ${agentKind}:${model}`,
    );
  }
  console.log(
    `\n  base ${baseRef}  ·  ` +
      (integrationBranch === null
        ? 'no integration branch — each branch is its own deliverable'
        : `integrates into ${integrationBranch}`),
  );
  console.log('  Nothing is pushed to origin.\n');

  // A cycle can never drain, so say so before the first container spends quota
  // on the slices that can run, rather than only in the end-of-run summary.
  if (mode === 'prd') {
    for (const cycle of findDependencyCycles(slices)) {
      console.warn(
        `  ⚠ dependency cycle: ${formatCycle(cycle)} — these slices will not run ` +
          'until a `## Blocked by` section is corrected.\n',
      );
    }
  }
}

if (dryRun) {
  printPlanPreview();
  console.log(
    'Dry run — no worktree, container, or GitHub write was performed.',
  );
  process.exit(0);
}

// PRD mode has no confirmation prompt by design — it is the AFK path. That made its
// branch handling invisible: nothing was printed before a slice branch was deleted
// and recreated. Printing the plan costs nothing and is what makes destruction
// observable. See ADR 0035.
if (mode === 'prd') {
  printPlanPreview();
}

// A sweep is the only mode where no human named the work. Everything selected here
// spends real model quota, so the set is shown and confirmed before the first
// container starts.
if (mode === 'sweep' && !assumeYes) {
  printPlanPreview();

  if (!process.stdin.isTTY) {
    fail(
      'A sweep needs confirmation, but stdin is not interactive.\n' +
        'Re-run with --dry-run to inspect the selection, or --yes to accept it.',
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (
    await rl.question(`Dispatch these ${slices.length} issue(s)? [y/N] `)
  )
    .trim()
    .toLowerCase();
  rl.close();

  if (answer !== 'y' && answer !== 'yes') {
    console.log('Aborted — nothing was dispatched.');
    process.exit(0);
  }
  console.log('');
}

console.log(`Dispatching ${slices.length} slice(s) one by one...\n`);

const results: SliceResult[] = [];
const crashed: Array<{ issue: Issue; error: string }> = [];
const pendingSlices = [...slices];

while (pendingSlices.length > 0) {
  const issue = nextReadySlice(pendingSlices);
  if (!issue) {
    for (const { issue: blockedIssue, reason } of describeBlockedSlices(
      pendingSlices,
      dependencyStatus,
    )) {
      console.error(`  ⚠ #${blockedIssue.number} ${reason}`);
      results.push({
        issue: blockedIssue,
        sliceBranch: sliceBranchFor(blockedIssue),
        commits: 0,
        merged: false,
        reason,
      });
    }
    break;
  }

  pendingSlices.splice(pendingSlices.indexOf(issue), 1);
  const model = resolveModel(issue, agentKind);
  const agent = buildAgent(agentKind, model);
  const sliceBranch = sliceBranchFor(issue);

  ghSilent([
    'issue',
    'edit',
    String(issue.number),
    '--repo',
    REPO,
    '--add-label',
    'status:in-progress',
  ]);

  // Stamped before the try so the catch can see it: the crash path uses it to tell
  // this run's session transcripts from an earlier slice's by mtime.
  const crashedRunStartedAt = new Date();

  try {
    console.log(
      `\n  → #${issue.number} on ${sliceBranch} (${agentKind}:${model})`,
    );

    // Does this slice already carry a Slice Checkpoint from an interrupted run?
    // Resume is the default; destroying preserved work is the deliberate act.
    const disposition = decideSliceDisposition({
      ...inspectSliceBranch(sliceBranch),
      discardRequested,
    });

    if (disposition === SLICE_DISPOSITIONS.skipStale) {
      // Slices stack, so a checkpoint left behind while later slices integrated is
      // based on a head that is no longer in the feature branch's history. Rebasing
      // it is a judgement call and deleting it destroys work nobody has reviewed —
      // so do neither, and say so.
      console.error(
        `  ⚠ #${issue.number} ${sliceBranch} carries a checkpoint based on a superseded ` +
          `head — skipping.\n` +
          `      Rebase it onto ${baseRef} and re-run, or discard it deliberately.\n` +
          `      Recovery: docs/sandcastle/RUNBOOK.md — "Recovering an interrupted run".`,
      );
      ghSilent([
        'issue',
        'edit',
        String(issue.number),
        '--repo',
        REPO,
        '--remove-label',
        'status:in-progress',
      ]);
      results.push({
        issue,
        sliceBranch,
        commits: 0,
        merged: false,
        reason: 'checkpoint is based on a superseded head',
      });
      continue;
    }

    const checkpoint =
      disposition === SLICE_DISPOSITIONS.resume
        ? readSliceCheckpoint(sliceBranch)
        : undefined;

    const { triageBrief, maintainerNotes } = readIssueAmendments(issue.number);
    const parentPrd = readParentPrd(issue);
    if (parentPrd) {
      console.log(
        `  [#${issue.number}] carrying PRD #${parentPrd.number} into the brief.`,
      );
    }
    if (triageBrief) {
      console.log(
        `  [#${issue.number}] carrying its triage brief into the brief.`,
      );
    }
    if (maintainerNotes.length > 0) {
      console.log(
        `  [#${issue.number}] carrying ${maintainerNotes.length} maintainer note(s) into the brief.`,
      );
    }

    const worktreePath = join(worktreesDir, sliceBranch.replace(/\//g, '-'));

    const priorRun = checkpoint
      ? readPriorRun(issue.number, sliceBranch)
      : undefined;

    if (checkpoint && priorRun) {
      // Say which of the two it is. "resuming from checkpoint" on a slice whose only
      // problem was a red gate is the same misreport the agent used to receive.
      const because =
        priorRun.kind === PRIOR_RUN_KINDS.interrupted
          ? 'interrupted run'
          : 'completed run whose gate failed';
      console.log(
        `  [#${issue.number}] resuming from ${because} at ${checkpoint.sha} ` +
          `(${checkpoint.files.length} file(s)) — the branch is kept, not recreated.` +
          (priorRun.handoff.length > 0
            ? `\n  [#${issue.number}] carrying ${priorRun.handoff.length} handoff marker(s) into the brief.`
            : ''),
      );
      // The branch and its commits stay. Only the worktree is rebuilt, so the agent
      // gets a clean checkout of the checkpoint rather than whatever partial state
      // the interrupted container left on disk.
      ensureWorktreeRegistered(issue.number, worktreePath, sliceBranch);
      if (existsSync(worktreePath)) {
        spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
          encoding: 'utf8',
          windowsHide: true,
        });
      }
      spawnSync('git', ['worktree', 'prune'], {
        encoding: 'utf8',
        windowsHide: true,
      });
    } else {
      // Fresh slice branch + worktree off the CURRENT local feature head, so this
      // slice (processed one by one) builds on every previously-integrated slice.
      // Clear any stale branch/worktree from an earlier run first — including one
      // filed under a different type prefix, if this issue's labels have changed
      // since it last ran.
      const staleBranches = [sliceBranch, ...staleWorkBranchesFor(issue)];
      for (const stale of staleBranches) {
        const stalePath = join(worktreesDir, stale.replace(/\//g, '-'));
        ensureWorktreeRegistered(issue.number, stalePath, stale);
        if (existsSync(stalePath)) {
          spawnSync('git', ['worktree', 'remove', '--force', stalePath], {
            encoding: 'utf8',
            windowsHide: true,
          });
        }
      }
      spawnSync('git', ['worktree', 'prune'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      for (const stale of staleBranches) {
        spawnSync('git', ['branch', '-D', stale], {
          encoding: 'utf8',
          windowsHide: true,
        });
      }
      gitCmd(['branch', '--no-track', sliceBranch, baseRef]);
    }
    const wt = spawnSync(
      'git',
      ['worktree', 'add', worktreePath, sliceBranch],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    if (wt.status !== 0) {
      throw new Error(
        `could not create worktree for ${sliceBranch}: ${wt.stderr.trim()}`,
      );
    }

    const result = await finishedDespiteCleanup(
      issue,
      sliceBranch,
      run({
        agent,
        sandbox: docker({
          env: {
            NX_DAEMON: 'false',
            NX_ISOLATE_PLUGINS: 'false',
            NX_SKIP_NX_CACHE: 'true',
            // Pin the cache to the bind-mounted worktree itself. Unset, Nx tries to
            // resolve a "main worktree" root to share the cache across worktrees —
            // a path that does not exist inside the container — and falls back to
            // .nx/cache-local / .nx/workspace-data-local (both gitignored, but the
            // resolution failure is still wasted work every run). See ADR 0036.
            NX_CACHE_DIRECTORY: '/home/agent/workspace/.nx/cache',
            NX_WORKSPACE_DATA_DIRECTORY:
              '/home/agent/workspace/.nx/workspace-data',
            ...providerEnvironment(),
            ...YARN_CACHE_ENV,
          },
          // Bind-mount the shared, content-addressable Yarn global cache so the
          // in-container install (below) is incremental and never re-downloads
          // across slices.
          mounts: [
            { hostPath: yarnCacheDir, sandboxPath: '/home/agent/.yarn-cache' },
            {
              hostPath: sessionsDir,
              sandboxPath: '/home/agent/.claude/projects',
            },
            ...(graphifyAvailable
              ? [
                  {
                    hostPath: 'graphify-out',
                    sandboxPath: 'graphify-out',
                    readonly: true,
                  },
                ]
              : []),
          ],
        }),
        name: `#${issue.number}`,
        branchStrategy: {
          type: 'branch',
          branch: sliceBranch,
          baseBranch: baseRef,
        },
        // Install this slice's deps INSIDE the container before the agent starts, so
        // native binaries match the container's platform (correct on WSL2, Linux, and
        // macOS hosts). Writes node_modules to the bind-mounted worktree, which MUST
        // be on a native fs (ext4/APFS) — ~2 min there vs ~29 min on a Windows mount.
        hooks: {
          sandbox: {
            onSandboxReady: [
              {
                command: 'corepack yarn install --immutable',
                timeoutMs: 1200000,
              },
            ],
          },
        },
        // Iterations after the first do NOT resume the agent session: each spins a
        // fresh sandbox, re-runs the dependency install, and receives the identical
        // prompt. They are cold restarts, not continuations, so an agent that failed
        // to signal completion once meets the same wall again at full price. Two buys
        // one honest retry for a transient container fault; genuine continuation is
        // the resume path, which supplies a different prompt. See ADR 0035.
        maxIterations: 2,
        // Quiet stretches (codegen, builds) can exceed the 600s default and trip the
        // idle watchdog; give long-running slices headroom.
        idleTimeoutSeconds: 1800,
        prompt: (() => {
          // Notes wrap the base prompt, so the resume brief inherits them too: a
          // maintainer reviewing a checkpoint is the likeliest author of one.
          const basePrompt = withMaintainerNotes(
            withTriageBrief(
              buildPrompt(issue, sliceBranch, parentPrd),
              triageBrief,
            ),
            maintainerNotes,
          );
          return checkpoint
            ? buildResumeBrief({
                basePrompt,
                issueNumber: issue.number,
                sliceBranch,
                checkpoint,
                ...priorRun,
              })
            : basePrompt;
        })(),
      }),
    );

    if (sandboxClaudeCode && result.logFilePath) {
      appendFileSync(
        result.logFilePath,
        `\n${claudeCodeLogLine({
          issueNumber: issue.number,
          ...sandboxClaudeCode,
          image: SANDBOX_IMAGE,
        })}\n`,
      );
    }
    logRunUsage(issue.number, agentKind, model, result);
    captureSubagentTraces(issue, result);

    // Finalize → gate → integrate, all LOCAL. No push, no PR.
    // Standalone runs stop after the gate: with no integration branch the work
    // branch is already the deliverable, so "succeeded" means gate-passed.
    const hasWork = finalizeSliceBranch(issue, sliceBranch);

    // PRD mode does NOT gate per slice. One red gate used to strand the whole run:
    // the slice did not integrate, the wave driver aborted, and an overnight PRD
    // finished the night with nothing done — twice, on gate bugs that had nothing
    // to do with the code. Integrate every slice that produced work and gate the
    // assembled feature branch once at the end, which is also the only scope that
    // can see two slices breaking each other. Standalone keeps its per-slice gate:
    // its branch IS the deliverable, so there is no later gate to defer to.
    // See ADR 0045.
    const gatePassed =
      integrationBranch !== null
        ? hasWork
        : hasWork
          ? runSliceGate(issue, sliceBranch)
          : false;
    const mergeOk = !gatePassed
      ? false
      : integrationBranch === null
        ? true
        : integrateSlice(issue, sliceBranch, integrationBranch);

    // Judge the run before claiming it finished (ADR 0111). Integration above is
    // unconditional in PRD mode (ADR 0045); closing the slice and releasing what
    // depends on it is not. Mobile v1 closed every slice that committed anything,
    // including one whose own output said "## Not delivered — keep-awake".
    const outcome = judgeRunOutcome(
      readRunLog(result.logFilePath, issue.number),
    );

    if (mergeOk && integrationBranch !== null) {
      ghSilent([
        'issue',
        'edit',
        String(issue.number),
        '--repo',
        REPO,
        '--remove-label',
        'status:in-progress',
        '--add-label',
        'status:done',
      ]);
    }

    if (mergeOk && integrationBranch !== null && !outcome.clean) {
      // Held: integrated and status:done, so a re-run skips it (ADR 0045), but open
      // as ready-for-human with the agent's own list, and its dependents stay
      // blocked until a person closes it (isSatisfiedAsDependency).
      ghSilent([
        'issue',
        'edit',
        String(issue.number),
        '--repo',
        REPO,
        '--remove-label',
        'ready-for-agent',
        '--add-label',
        NEEDS_HUMAN_LABEL,
      ]);
      ghSilent([
        'issue',
        'comment',
        String(issue.number),
        '--repo',
        REPO,
        '--body',
        formatHeldComment({
          outstanding: outcome.outstanding,
          integrationBranch,
          commits: result.commits.length,
        }),
      ]);
      console.log(
        `  [#${issue.number}] integrated but held for a person: ${outcome.outstanding.length} item(s) outstanding.`,
      );
    } else if (mergeOk && integrationBranch !== null) {
      // Close the slice on successful local integration. status:done + closed
      // makes re-runs idempotent — both this orchestrator's open+afk filter and
      // dispatch-waves treat a closed slice as complete and skip it. The work is
      // on the local feature branch and reaches `main` via the manual PRD PR.
      ghSilent([
        'issue',
        'close',
        String(issue.number),
        '--repo',
        REPO,
        '--reason',
        'completed',
        '--comment',
        // Do NOT claim the gate passed: under ADR 0045 a PRD slice is not gated
        // individually at all. The PRD is gated once, on the assembled branch,
        // and that verdict is reported on the PRD issue.
        `Agent completed. ${result.commits.length} commit(s) on \`${sliceBranch}\`.\n` +
          `Integrated into the local \`${integrationBranch}\` (fast-forward, not pushed) and closed as completed.\n\n` +
          `This slice was **not** gated on its own. The whole PRD is gated once on the ` +
          `assembled feature branch and the verdict is posted on the PRD issue. ` +
          `It reaches \`main\` via the manual PRD PR.`,
      ]);
      unblockDependents(issue);
    } else if (mergeOk) {
      // Standalone success. The issue stays open, handed to a person rather than
      // marked status:done: nothing has reached `main`, and status:done would
      // count it as a finished dependency for work on an unpushed local branch.
      ghSilent([
        'issue',
        'edit',
        String(issue.number),
        '--repo',
        REPO,
        ...STANDALONE_HANDOFF_LABELS.remove.flatMap((label) => [
          '--remove-label',
          label,
        ]),
        ...STANDALONE_HANDOFF_LABELS.add.flatMap((label) => [
          '--add-label',
          label,
        ]),
      ]);
      ghSilent([
        'issue',
        'comment',
        String(issue.number),
        '--repo',
        REPO,
        '--body',
        formatStandaloneReadyComment({
          outstanding: outcome.outstanding,
          sliceBranch,
          baseRef,
          commits: result.commits.length,
        }),
      ]);
    } else {
      ghSilent([
        'issue',
        'edit',
        String(issue.number),
        '--repo',
        REPO,
        '--remove-label',
        'status:in-progress',
      ]);
      const reason = !hasWork
        ? 'it produced no commits'
        : !gatePassed
          ? `the build gate (${process.env.SLICE_GATE_TARGETS || 'lint test build'}) failed`
          : 'the local fast-forward integration failed';
      ghSilent([
        'issue',
        'comment',
        String(issue.number),
        '--repo',
        REPO,
        '--body',
        integrationBranch === null
          ? `Agent finished but ${reason}. The local branch \`${sliceBranch}\` is left in place for inspection.`
          : `Agent finished but ${reason} — slice was NOT integrated into \`${integrationBranch}\`. ` +
            `The local branch \`${sliceBranch}\` is left in place for inspection. ` +
            `Later slices in this PRD will NOT include this one until it is fixed and re-run.`,
      ]);
      results.push({
        issue,
        sliceBranch,
        commits: result.commits.length,
        merged: false,
        reason,
      });
      continue;
    }

    results.push({
      issue,
      sliceBranch,
      commits: result.commits.length,
      merged: true,
      reason:
        integrationBranch === null
          ? 'gate passed'
          : outcome.clean
            ? 'integrated'
            : 'integrated, held for a person',
    });
    // A held slice is integrated but releases nothing that depends on it.
    if (integrationBranch === null || outcome.clean) {
      completedIssueNumbers.add(issue.number);
    }
  } catch (e) {
    ghSilent([
      'issue',
      'edit',
      String(issue.number),
      '--repo',
      REPO,
      '--remove-label',
      'status:in-progress',
    ]);

    // Preserve BEFORE reporting: the agent's work is the expensive thing here, and
    // the next dispatch of this issue deletes the branch it lives on.
    const checkpoint = preserveInterruptedSlice(issue, sliceBranch);

    // Same reasoning applied to the transcripts: a crashed run is the one whose
    // sub-agent behaviour you most want to read, and sandcastle never captured it.
    recoverSubagentTracesAfterCrash(issue, crashedRunStartedAt);

    console.error(`  ✗ #${issue.number} crashed: ${String(e)}`);
    const log = readSliceLogTail(issue.number);
    const tail = formatCrashLogTail(log);
    if (tail) {
      console.error(
        `  [#${issue.number}] the thrown error may be trailing stderr noise rather than the cause:`,
      );
      console.error(tail);
    }

    // Was this a provider usage limit, and did the maintainer ask us to wait it out?
    // Classification is provider-keyed: a provider whose limit format we have never
    // observed classifies as `unknown` and never triggers a wait.
    const failedAt = new Date();
    const classification = classifyRunFailure({
      agentKind,
      logTail: log?.tail ?? [],
      now: failedAt,
    });
    const waitDecision = decideWaitPolicy({
      classification,
      waitEnabled: waitForQuota,
      waitsTaken: quotaWaitsTaken,
      now: failedAt,
    });

    if (waitDecision.action === 'wait' && waitDecision.until) {
      const untilMs = waitDecision.until.getTime() - Date.now();
      // A small margin past the stated reset: waking exactly on it risks meeting the
      // same wall and burning one of the two waits for nothing.
      const sleepMs = Math.max(untilMs, 0) + 5 * 60 * 1000;
      quotaWaitsTaken += 1;
      // Local time and duration, not a UTC timestamp: the sleep length is the same
      // either way, but a person can only judge whether it is SANE from the duration.
      console.error(
        `  [#${issue.number}] provider limit hit — ${classification.evidence ?? 'no detail'}\n` +
          `      Parking until ${formatWaitWindow(waitDecision.until, failedAt)}, ` +
          `+5m margin, wait ${quotaWaitsTaken}/${MAX_QUOTA_WAITS}.\n` +
          `      The slice will RESUME from its checkpoint, not restart.\n` +
          `      Ctrl-C is safe — the checkpoint is already committed.`,
      );
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      console.log(`  [#${issue.number}] resuming after the limit reset.`);
      // Back into the queue: the next pass finds the checkpoint and resumes it.
      pendingSlices.push(issue);
      continue;
    }

    if (waitForQuota) {
      console.error(
        `  [#${issue.number}] not waiting — ${waitDecision.reason}.`,
      );
    }

    if (checkpoint) {
      console.error(
        `  [#${issue.number}] checkpoint ${checkpoint.sha} on ${sliceBranch} ` +
          `(${checkpoint.fileCount} file(s)), tagged ${checkpoint.tag}.\n` +
          `      The tag keeps this work reachable if the branch is later deleted.\n` +
          `      Recovery: docs/sandcastle/RUNBOOK.md — "Recovering an interrupted run".`,
      );
      ghSilent([
        'issue',
        'comment',
        String(issue.number),
        '--repo',
        REPO,
        '--body',
        `Agent run ended without a completion signal. Its work was preserved as a ` +
          `Slice Checkpoint \`${checkpoint.sha}\` on the local branch \`${sliceBranch}\` ` +
          `(${checkpoint.fileCount} file(s)), tagged \`${checkpoint.tag}\`.\n\n` +
          `This is local and unpushed, and it is **not** reviewed or gated — files ` +
          `present in a checkpoint do not mean a Gated Pipeline ran. See ` +
          `\`docs/sandcastle/RUNBOOK.md\` under "Recovering an interrupted run".`,
      ]);
    } else {
      console.error(
        `  [#${issue.number}] nothing to preserve — the run left no work on ${sliceBranch}.`,
      );
    }

    crashed.push({ issue, error: String(e) });
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const merged = results.filter((r) => r.merged);
/**
 * Put the PRD-level gate verdict where a sleeping maintainer will find it.
 *
 * The terminal scrollback is gone by morning and the run may have ended hours ago,
 * so the verdict also goes on the PRD issue — that is the notification that reaches
 * a phone. Slices stay closed either way: they integrated, and re-running must keep
 * skipping them. A red feature gate is a fact about the ASSEMBLY, not about any one
 * slice. See ADR 0045.
 */
function assemblySummary(): string {
  // A gate verdict has to carry its own scope. "The PRD is green" was printed by a
  // run that dispatched one slice of three — true about the branch, and read by a
  // maintainer as a statement about the PRD. Say how much was assembled.
  if (prdNumber === undefined) return '';
  const assembly = describeAssembly(allIssues, prdNumber);
  return assembly.complete
    ? `all ${assembly.total} slice(s) assembled`
    : `${assembly.summary} — the PRD is NOT complete`;
}

function reportFeatureGate(featureBranch: string, ok: boolean): void {
  if (prdNumber === undefined) return;
  const body = ok
    ? `Build gate **passed** on the integrated feature branch \`${featureBranch}\` ` +
      `(\`${prdGateBase}...${featureBranch}\`, the same scope CI runs on the PR).\n\n` +
      `Assembly: ${assemblySummary()}. The gate is a fact about the branch, not a ` +
      `claim that every slice ran.\n\n` +
      `Nothing is pushed. QA the local branch, then push it and open one PR.`
    : `Build gate **failed** on the integrated feature branch \`${featureBranch}\` ` +
      `(\`${prdGateBase}...${featureBranch}\`, the same scope CI runs on the PR).\n\n` +
      `Every slice that produced work is still integrated and every slice branch is ` +
      `intact — nothing was discarded and nothing is pushed. The failure is a fact ` +
      `about the assembled branch, which is why the slices remain closed.\n\n` +
      `Gate output is in the run log. To find the slice responsible, the slice ` +
      `commits are in order on the branch:\n\n` +
      '```bash\n' +
      `git log --oneline ${prdGateBase}..${featureBranch}\n` +
      '```';
  ghSilent([
    'issue',
    'comment',
    String(prdNumber),
    '--repo',
    REPO,
    '--body',
    body,
  ]);
}

const blocked = results.filter((r) => !r.merged);
const succeededVerb = integrationBranch === null ? 'ready' : 'integrated';

console.log(`\n${'─'.repeat(55)}`);
console.log(
  `Batch done: ${merged.length} ${succeededVerb}, ${blocked.length} blocked (gate/no-work), ${crashed.length} crashed.\n`,
);

for (const r of merged) {
  console.log(
    integrationBranch === null
      ? `  ✓ #${r.issue.number} ready — ${r.commits} commit(s) on ${r.sliceBranch}`
      : `  ✓ #${r.issue.number} integrated — ${r.commits} commit(s) on ${integrationBranch}`,
  );
}
for (const r of blocked) {
  console.error(`  ⚠ #${r.issue.number} NOT ${succeededVerb} — ${r.reason}`);
}
for (const r of crashed) {
  console.error(`  ✗ #${r.issue.number} crashed — ${r.error}`);
}

if (blocked.length > 0 || crashed.length > 0) {
  console.log(
    integrationBranch === null
      ? `\nThe run did not finish cleanly. Inspect the branch above, then fix and re-run.`
      : `\nOne or more slices did not integrate. Fix them and re-run — done slices are skipped.`,
  );
}
// ─── One gate, on the assembled feature branch ────────────────────────────────
// PRD mode defers every per-slice gate to here. `--defer-gate` suppresses even
// this one: dispatch-waves invokes this file ONCE PER WAVE, so without the flag a
// three-wave PRD would gate three times. The driver passes it and runs the gate
// itself after the last wave. See ADR 0045.
let featureGateOk: boolean | undefined;
if (integrationBranch !== null && merged.length > 0 && !deferGate) {
  featureGateOk = runFeatureGate(integrationBranch);
  console.log(
    featureGateOk
      ? `\n  gate: PASS on ${integrationBranch} against ${prdGateBase} — ${assemblySummary()}.`
      : `\n  gate: FAIL on ${integrationBranch}. Every slice is still integrated; ` +
          `nothing was discarded and nothing is pushed.`,
  );
  reportFeatureGate(integrationBranch, featureGateOk);
} else if (integrationBranch !== null && deferGate) {
  console.log(
    `\n  gate: deferred — the wave driver gates ${integrationBranch} once, after the last wave.`,
  );
}

if (merged.length > 0) {
  const deliverable = integrationBranch ?? merged[0].sliceBranch;
  console.log(`\nNext step: QA the local \`${deliverable}\` branch`);
  console.log(
    integrationBranch === null
      ? `  git switch ${deliverable}   # the agent's work for this issue`
      : `  git switch ${deliverable}   # it now contains the merged slices`,
  );
  // Agents read this line as an instruction, so it names the repository's only
  // PR entry point: `ai:create-pr` pushes, checks the merge base, and applies
  // Surface Labels. A bare `git push && gh pr create` skips all three (AGENTS.md).
  console.log(
    `Then open ONE PR to \`main\` so CI runs, through the create-pull-request-workflow Skill:`,
  );
  console.log(
    `  PrAuthor drafts it; \`corepack yarn ai:create-pr --title <t> --body-file <f> --merge-base <sha>\` pushes and opens it.`,
  );
}

// ─── Desktop notification (best-effort; Windows / WSL2 only) ───────────────────

const runLabel = (
  mode === 'prd' ? `PRD #${prdNumber}` : `Issue #${issueNumber}`
).replace(/'/g, "''");
spawnSync(
  'powershell.exe',
  [
    '-Command',
    [
      'Add-Type -AssemblyName System.Windows.Forms;',
      `[System.Windows.Forms.MessageBox]::Show(`,
      `  '${merged.length} ${succeededVerb}, ${blocked.length} blocked, ${crashed.length} crashed.` +
        `\\n${runLabel}',`,
      `  'dispatch-agents complete', 'OK', 'Information'`,
      `)`,
    ].join(' '),
  ],
  { windowsHide: true },
);
