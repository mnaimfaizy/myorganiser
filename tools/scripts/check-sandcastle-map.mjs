#!/usr/bin/env node
// Asserts that the five sandcastle atlas pages still describe the system they claim to.
//
//   node tools/scripts/check-sandcastle-map.mjs
//
// The pages are hand-designed diagrams, so their prose cannot be generated. What can be
// checked is their numbers. Each page carries one embedded manifest, split into two groups
// because they have different assertion strengths:
//
//   assertedFromExports          Every key resolves to a real `export` in one of the
//                                sandcastle libs, or to a JSON path in the model policy /
//                                package.json / a CI workflow. Verified by IMPORTING and
//                                READING, the way tools/scripts/check-agent-map.mjs does.
//
//   assertedFromOrchestratorSource
//                                Module-local literals inside .sandcastle/main.mts,
//                                .sandcastle/dispatch-waves.mts, and the slice-selection
//                                lib they share, with no export to import,
//                                verified by ANCHORED regex against the source text.
//                                Anchored — `^…$` on the whole statement — and never a bare
//                                substring search: ADR 0043 records a gate that passed
//                                because `yarn openapi:artifacts` matched
//                                `openapi:artifacts:test`. A substring match here would
//                                reproduce that defect exactly.
//
// Three properties are asserted beyond "the value is right":
//
//   1. DUPLICATE FACTS MUST AGREE. Several facts are written twice in the source (the gate
//      targets, the checkpoint tag, the sub-agent dest dir). Each such key states how many
//      occurrences it expects and requires them to be identical, so a third copy or a
//      one-sided edit is a finding rather than a silent divergence.
//
//   2. PAGES MUST AGREE WITH EACH OTHER. A key that appears on two pages must carry the
//      same value on both. Five pages describing one system is five chances to drift.
//
//   3. A VALUE THE PROSE NEVER SAYS IS A FACT THE READER CANNOT SEE. Every asserted value is
//      also required to appear in the rendered body, bare or thousands-grouped.
//
// This checker exists in this shape because the previous one-page version stayed green
// through the whole of PR #467 while the page's prose went false around it: #467 changed
// the gate MODEL and the wave failure MODE without moving a single asserted constant.
// Constants alone are not enough, but they are what a script can hold. Keep the manifests
// wide, and prefer a value that pins behaviour over one that pins a number.
//
// Exit 0 = in sync. Exit 1 = drift (fix the page, or the source moved). Exit 2 = could not run.
import { readFileSync, existsSync } from 'node:fs';

const RESUME = 'tools/scripts/lib/sandcastle-resume.ts';
const TRACE = 'tools/scripts/lib/sandcastle-subagent-trace.ts';
const OUTCOME = 'tools/scripts/lib/sandcastle-outcome.mjs';
const POLICY = 'tools/config/agent-model-policy.json';
const PKG = 'package.json';
const MAIN = '.sandcastle/main.mts';
const WAVES = '.sandcastle/dispatch-waves.mts';
const CI = '.github/workflows/ci.yml';
const SELECTION = 'tools/scripts/lib/sandcastle-slice-selection.ts';

const PAGES = [
  ['docs/sandcastle/dispatch-map.html', 'sandcastle-dispatch-manifest'],
  ['docs/sandcastle/waves.html', 'sandcastle-waves-manifest'],
  ['docs/sandcastle/gates.html', 'sandcastle-gates-manifest'],
  ['docs/sandcastle/logs.html', 'sandcastle-logs-manifest'],
  ['docs/sandcastle/resume.html', 'sandcastle-resume-manifest'],
];

const fail = (msg) => {
  console.error(`sandcastle-map: ${msg}`);
  process.exit(2);
};

for (const f of [
  RESUME,
  TRACE,
  OUTCOME,
  POLICY,
  PKG,
  MAIN,
  WAVES,
  CI,
  SELECTION,
]) {
  if (!existsSync(f)) fail(`${f} not found`);
}
for (const [page] of PAGES) {
  if (!existsSync(page)) fail(`${page} not found`);
}

const mainSrc = readFileSync(MAIN, 'utf8');
const wavesSrc = readFileSync(WAVES, 'utf8');
const selectionSrc = readFileSync(SELECTION, 'utf8');
const ciSrc = readFileSync(CI, 'utf8');
const policy = JSON.parse(readFileSync(POLICY, 'utf8'));
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));

const resume = await import(`../../${RESUME}`).catch((err) =>
  fail(`could not import ${RESUME}: ${err.message}`),
);
const trace = await import(`../../${TRACE}`).catch((err) =>
  fail(`could not import ${TRACE}: ${err.message}`),
);
const outcome = await import(`../../${OUTCOME}`).catch((err) =>
  fail(`could not import ${OUTCOME}: ${err.message}`),
);

const sandcastlePolicy = policy?.orchestrators?.sandcastle;
if (!sandcastlePolicy) fail(`${POLICY} has no orchestrators.sandcastle block`);

const findings = [];
const add = (page, msg) => findings.push(`[${page}] ${msg}`);

// ── Group 1: importable / readable ────────────────────────────────────────────
// One resolver per key, shared by every page that claims it. A key claimed by a page but
// absent here is itself a finding: the checker must not silently accept a value it cannot
// verify, which is how a manifest becomes decoration.

const sandcastleVersion =
  pkg.dependencies?.['@ai-hero/sandcastle'] ??
  pkg.devDependencies?.['@ai-hero/sandcastle'];

/** The `nx affected -t <target>` command CI actually runs, without its --base/--head args. */
const ciAffected = (target) => {
  const re = new RegExp(
    `^\\s*run: corepack yarn (nx affected -t ${target}) --base=`,
    'm',
  );
  const m = ciSrc.match(re);
  return m ? m[1] : undefined;
};

/** One realistic sub-agent summary, so index rendering is proved by output, not by reading. */
const SAMPLE_SUMMARY = {
  agentId: 'a',
  agentType: 'Probe',
  skill: undefined,
  model: 'm',
  mcpServers: [],
  turnCount: 1,
  toolCalls: [],
  usage: {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  },
  peakContextTokens: 0,
  fileName: 'agent-a.jsonl',
};
const renderIndex = () =>
  trace.formatSubagentIndex?.([SAMPLE_SUMMARY], {
    issueNumber: 1,
    sliceBranch: 'b',
  });

const EXPORT_RESOLVERS = {
  packageSandcastleVersion: () => sandcastleVersion,

  // policy
  policySandcastleClaudeModelLow: () =>
    sandcastlePolicy.claudeByComplexity?.low,
  policySandcastleClaudeModelMedium: () =>
    sandcastlePolicy.claudeByComplexity?.medium,
  policySandcastleClaudeModelHigh: () =>
    sandcastlePolicy.claudeByComplexity?.high,
  policySandcastleCursorDefault: () => sandcastlePolicy.cursorDefault,
  policySandcastleCopilotDefault: () => sandcastlePolicy.copilotDefault,

  // resume lib — dispositions and prior-run kinds
  resumeSliceDispositions: () => Object.values(resume.SLICE_DISPOSITIONS ?? {}),
  resumePriorRunKinds: () => Object.values(resume.PRIOR_RUN_KINDS ?? {}),
  resumeLimitClassifications: () =>
    Object.values(resume.LIMIT_CLASSIFICATIONS ?? {}),

  // resume lib — guardrail counts. Asserted per set, not just as a total: #467 split them
  // because the interrupted pair is FALSE about a run that finished and failed the gate.
  resumeGuardrailCount: () => resume.RESUME_GUARDRAILS?.length,
  resumeGuardrailCountCommon: () => resume.RESUME_GUARDRAILS_COMMON?.length,
  resumeGuardrailCountInterrupted: () => resume.INTERRUPTED_GUARDRAILS?.length,
  resumeGuardrailCountGateFailure: () => resume.GATE_FAILURE_GUARDRAILS?.length,
  resumeGuardrailCountPerBrief: () =>
    resume.resumeGuardrails?.(resume.PRIOR_RUN_KINDS?.interrupted)?.length,

  // outcome lib — what a run must print, and what a held slice is labelled (ADR 0111)
  outcomeCompletionPromise: () => outcome.COMPLETION_PROMISE,
  outcomeOutstandingMarker: () => outcome.OUTSTANDING_MARKER,
  outcomeNeedsHumanLabel: () => outcome.NEEDS_HUMAN_LABEL,

  // resume lib — markers and caps
  resumeHandoffMarker: () => resume.HANDOFF_MARKER,
  resumeHandoffMaxLines: () => resume.MAX_HANDOFF_LINES,
  resumeDiscardFlag: () => resume.DISCARD_FLAG,
  resumeMaintainerNoteMarker: () => resume.MAINTAINER_NOTE_MARKER,
  resumeSliceLogRunStartMarker: () => resume.RUN_START_MARKER,
  resumeQuotaMaxWaits: () => resume.MAX_QUOTA_WAITS,
  resumeQuotaMaxWaitsPerRun: () => resume.MAX_QUOTA_WAITS,
  resumeQuotaMaxWaitMs: () => resume.MAX_WAIT_MS,
  resumeLimitMatcherCountClaude: () => resume.LIMIT_MATCHERS?.claude?.length,
  resumeLimitMatcherCountCursor: () => resume.LIMIT_MATCHERS?.cursor?.length,
  resumeLimitMatcherCountCopilot: () => resume.LIMIT_MATCHERS?.copilot?.length,

  // waves — verified by CALLING the pure planner, not by reading a constant.
  wavesForwardingRefusedFlag: () => resume.DISCARD_FLAG,
  wavesForwardingDriverOwnedFlags: () => {
    // Whatever the driver owns is precisely what planWaveForwarding refuses to forward.
    const argv = ['node', 'w', '--prd', '446', '--plan', '--agent', 'claude'];
    const plan = resume.planWaveForwarding?.(argv);
    if (!plan || plan.ok !== true) return undefined;
    return argv
      .slice(2)
      .filter((a) => a.startsWith('--') && !plan.forwarded.includes(a));
  },

  // logs — markers shared with the resume lib, plus formatter behaviour proved by CALLING it.
  logsRunStartMarker: () => resume.RUN_START_MARKER,
  logsHandoffMarker: () => resume.HANDOFF_MARKER,
  logsSliceLogTailLines: () => resume.tailLines?.('x\n'.repeat(80))?.length,
  logsFormatTokensThousand: () => trace.formatTokens?.(1000),
  logsFormatTokensMillion: () => trace.formatTokens?.(1500000),
  logsFormatTokensNoFalsePrecision: () => trace.formatTokens?.(204800),
  logsSubagentIndexFields: () => {
    const md = renderIndex();
    if (typeof md !== 'string') return undefined;
    return (
      md
        .split('\n')
        .filter((l) => l.startsWith('- '))
        // The usage row carries its caveat inline (`Token usage (summed …)`). The field
        // NAME is what the page lists; the caveat is asserted separately as
        // logsSubagentUsageCaveat, so strip the parenthetical rather than duplicating it.
        .map((l) =>
          l
            .slice(2)
            .split(':')[0]
            .replace(/\s*\([^)]*\)$/, ''),
        )
    );
  },
  logsSubagentUsageSplit: () => {
    // Read the four component labels back out of the rendered usage line.
    const md = renderIndex();
    if (typeof md !== 'string') return undefined;
    const line = md.split('\n').find((l) => l.startsWith('- Token usage'));
    if (!line) return undefined;
    return (
      line
        .split(':')
        .slice(1)
        .join(':')
        .match(/([a-z-]+) \d/g) ?? []
    ).map((s) => s.replace(/ \d$/, ''));
  },
  logsSubagentUsageCaveat: () => {
    const md = renderIndex();
    const m =
      typeof md === 'string' ? md.match(/- Token usage \(([^)]+)\)/) : null;
    return m ? m[1] : undefined;
  },
  logsSubagentEmptyMcpLine: () => {
    const md = renderIndex();
    if (typeof md !== 'string') return undefined;
    return md
      .split('\n')
      .find((l) => l.startsWith('- MCP servers'))
      ?.slice(2);
  },

  // CI, for the gate-vs-CI comparison the gates page draws.
  gateCiLintCommand: () => ciAffected('lint'),
  gateCiTestCommand: () => ciAffected('test'),
};

// ── Group 2: anchored regex against the orchestrator sources ─────────────────
//
// Every pattern is anchored on both ends of a whole statement (or block of statements).
// Leading indentation is `\s*` so a reformat does not fail the gate, but nothing else is
// loose — a pattern that matches a longer identifier or a different call site is the bug
// this design exists to prevent.
//
// `count` is the number of occurrences the source is expected to carry. Where it is >1 the
// fact is genuinely written more than once and every occurrence must produce the same
// value; a new copy that disagrees — or simply a new copy — is a finding.

const src = { main: mainSrc, waves: wavesSrc, selection: selectionSrc };
const first = (m) => m[1];
const num = (m) => Number(m[1]);

const CHECKPOINT_TAG = {
  file: MAIN,
  in: 'main',
  re: /^\s*const tag = `wip\/\$\{(?:issue\.number|issueNumber)\}-checkpoint`;$/gm,
  count: 2,
  t: () => 'wip/<issue>-checkpoint',
};
const MAX_ITERATIONS = {
  file: MAIN,
  in: 'main',
  re: /^\s*maxIterations: (\d+),$/gm,
  t: num,
};
const AFFECTED_TIMEOUT = {
  file: MAIN,
  in: 'main',
  re: /^\s*\{ encoding: 'utf8', windowsHide: true, timeout: (\d+) \},$/gm,
  t: num,
};
const QUOTA_MARGIN = {
  file: MAIN,
  in: 'main',
  re: /^\s*const sleepMs = Math\.max\(untilMs, 0\) \+ (\d+) \* (\d+) \* (\d+);$/gm,
  t: (m) => Number(m[1]) * Number(m[2]) * Number(m[3]),
};
/** prdGateBase drives both the feature-gate scope and the bisect command the page prints. */
const prdBase = () => {
  const m = mainSrc.match(/^const prdGateBase = gitRefExists\('([^']+)'\)/m);
  return m ? m[1] : '?';
};
// The slug is computed by `prdBranchSlug` rather than inline since ADR 0076
// (a slug may not begin with a digit run, or the resolver reads it as an issue
// number). The atlas claims the branch SHAPE, `feat/<slug>`, which is unchanged
// — so the anchor matches the shape and not the expression that fills it.
const FEAT_BRANCH = {
  file: MAIN,
  in: 'main',
  re: /^\s*const branch = `feat\/\$\{[^}]+\}`;$/gm,
};

const SOURCE_ASSERTIONS = {
  orchestratorSandboxImage: {
    file: MAIN,
    in: 'main',
    re: /^const SANDBOX_IMAGE = '([^']+)';$/gm,
  },
  orchestratorMaxIterations: MAX_ITERATIONS,
  resumeAgentMaxIterations: MAX_ITERATIONS,
  orchestratorIdleTimeoutSeconds: {
    file: MAIN,
    in: 'main',
    re: /^\s*idleTimeoutSeconds: (\d+),$/gm,
    t: num,
  },
  orchestratorInstallHookTimeoutMs: {
    file: MAIN,
    in: 'main',
    re: /^\s*timeoutMs: (\d+),$/gm,
    t: num,
  },
  orchestratorAffectedGraphTimeoutMs: AFFECTED_TIMEOUT,
  gateAffectedGraphTimeoutMs: AFFECTED_TIMEOUT,
  orchestratorSlugMaxChars: {
    file: MAIN,
    in: 'main',
    re: /^\s*\.slice\(0, (\d+)\);$/gm,
    t: num,
  },
  orchestratorPrdIssueListLimit: {
    file: MAIN,
    in: 'main',
    re: /^\s*'--state',\n\s*'all',\n\s*'--json',\n\s*'number,title,state,labels,body',\n\s*'--limit',\n\s*'(\d+)',$/gm,
    t: num,
  },
  orchestratorSweepIssueListLimit: {
    file: MAIN,
    in: 'main',
    re: /^\s*'--state',\n\s*'open',\n\s*'--json',\n\s*'number,title,state,labels,body',\n\s*'--limit',\n\s*'(\d+)',$/gm,
    t: num,
  },
  orchestratorQuotaWaitMarginMs: QUOTA_MARGIN,
  resumeQuotaWaitMarginMs: QUOTA_MARGIN,
  gateContainerTimeoutMs: {
    file: MAIN,
    in: 'main',
    re: /^\s*timeout: (\d+),$/gm,
    t: num,
  },

  // The checkpoint tag is built in two places — the crash path that writes it and the
  // resume path that probes for it. They must agree or resume silently stops recognising
  // its own checkpoints.
  orchestratorCheckpointTagPattern: CHECKPOINT_TAG,
  resumeCheckpointTagPattern: CHECKPOINT_TAG,
  resumeCheckpointCommitVerifyFlag: {
    file: MAIN,
    in: 'main',
    // Written on both checkpoint commit paths. Both must agree, or one of them starts
    // running husky over a half-finished worktree the run was killed in the middle of.
    re: /^\s*'(--no-verify)',$/gm,
    count: 2,
  },
  resumeQuotaWaitFlag: {
    file: MAIN,
    in: 'main',
    re: /^const waitForQuota = process\.argv\.includes\('(--wait-for-quota)'\);$/gm,
  },

  // ── gates ──────────────────────────────────────────────────────────────────
  gateTargetsEnvVar: {
    file: MAIN,
    in: 'main',
    re: /^\s*const targets = \(process\.env\.(SLICE_GATE_TARGETS) \|\| '[^']*'\)\.trim\(\);$/gm,
  },
  gateDisableEnvVar: {
    file: MAIN,
    in: 'main',
    re: /^\s*if \(\(process\.env\.(SLICE_GATE) \?\? ''\)\.toLowerCase\(\) === '[^']*'\) \{$/gm,
  },
  gateDisableEnvValue: {
    file: MAIN,
    in: 'main',
    re: /^\s*if \(\(process\.env\.SLICE_GATE \?\? ''\)\.toLowerCase\(\) === '([^']*)'\) \{$/gm,
  },
  gatePerFileTarget: {
    file: MAIN,
    in: 'main',
    re: /^\s*const perFileTargets = targetList\.filter\(\(t\) => t === '([^']+)'\);$/gm,
  },
  gatePrdBaseRef: {
    file: MAIN,
    in: 'main',
    re: /^const prdGateBase = gitRefExists\('([^']+)'\) \? '[^']+' : '[^']+';$/gm,
  },
  gatePrdBaseFallbackRef: {
    file: MAIN,
    in: 'main',
    re: /^const prdGateBase = gitRefExists\('[^']+'\) \? '[^']+' : '([^']+)';$/gm,
  },
  gateFeatureBranchScope: {
    ...FEAT_BRANCH,
    t: () => `${prdBase()}...feat/<slug>`,
  },
  gateBisectCommand: {
    ...FEAT_BRANCH,
    t: () => `git log --oneline ${prdBase()}..feat/<slug>`,
  },
  gateStandaloneScope: {
    file: MAIN,
    in: 'main',
    re: /^\s*return runGate\(`#\$\{issue\.number\}`, (baseRef), sliceBranch, issue\.number\);$/gm,
    t: (m) => `${m[1]}...<work branch>`,
  },
  gateWorktreePathPattern: {
    file: MAIN,
    in: 'main',
    re: /^\s*const gateRoot = join\(process\.cwd\(\), '(\.sandcastle)', '(gate)'\);$/gm,
    t: (m) => `${m[1]}/${m[2]}/<branch>`,
  },
  gateInstallCommand: {
    file: MAIN,
    in: 'main',
    re: /^\s*'(corepack yarn install --immutable)',$/gm,
  },
  gateNxSkipCacheFlag: {
    file: MAIN,
    in: 'main',
    // The template gained a trailing `${run.args…}` interpolation when the gate split
    // `test` into its own invocation so it could carry `--maxWorkers`. Stay anchored on
    // the run-many call and the flag; tolerate anything appended after it.
    re: /^\s*`node node_modules\/\.bin\/nx run-many -t \$\{run\.targets\.join\(' '\)\} --projects=\$\{run\.projects\.join\(','\)\} (--skip-nx-cache).*`,$/gm,
  },
  gateAffectedJsonFlag: {
    file: MAIN,
    in: 'main',
    // Anchored on the affected-graph call specifically: `'--json',` alone appears seven
    // times in this file, and #467 exists because this ONE call site was missing the flag.
    re: /^\s*'(--json)',\n\s*`--base=\$\{base\}`,\n\s*`--head=\$\{head\}`,$/gm,
  },
  gateAffectedProjectsCommand: {
    file: MAIN,
    in: 'main',
    re: /^\s*` {2}(nx show projects --affected) \$\{reason\}\$\{detail \? `: \$\{detail\}` : ''\}`,$/gm,
  },
  gateDeferFlag: {
    file: MAIN,
    in: 'main',
    re: /^const deferGate = process\.argv\.includes\('(--defer-gate)'\);$/gm,
  },
  gateOnlyFlag: {
    file: MAIN,
    in: 'main',
    re: /^const gateOnly = process\.argv\.includes\('(--gate-only)'\);$/gm,
  },
  gateHandoffPassMarker: {
    file: MAIN,
    in: 'main',
    re: /^\s*\? `(gate PASS) \(\$\{targets\}\)`$/gm,
  },
  gateHandoffFailMarker: {
    file: MAIN,
    in: 'main',
    re: /^\s*: `(gate FAILED) \(\$\{targets\}\)[^`]*`,$/gm,
  },
  gateTierLabels: {
    file: MAIN,
    in: 'main',
    re: /^function resolveGate\(issue: Issue\): '([a-z]+)' \| '([a-z]+)' \| '([a-z]+)' \{$/gm,
    t: (m) => [m[1], m[2], m[3]],
  },
  gateTierDefault: {
    file: MAIN,
    in: 'main',
    re: /^\s*if \(labels\.includes\('gate:full'\)\) return 'full';\n\s*return '([a-z]+)';$/gm,
  },
  gateTierMechanicalLabel: {
    file: MAIN,
    in: 'main',
    re: /^\s*if \(labels\.includes\('(gate:mechanical)'\)\) return '[a-z]+';$/gm,
  },
  gateTierFullLabel: {
    file: MAIN,
    in: 'main',
    re: /^\s*if \(labels\.includes\('(gate:full)'\)\) return '[a-z]+';$/gm,
  },

  // ── logs ───────────────────────────────────────────────────────────────────
  logsSliceLogDir: {
    file: MAIN,
    in: 'main',
    re: /^\s*const logsDir = join\(process\.cwd\(\), '(\.sandcastle)', '(logs)'\);$/gm,
    t: (m) => `${m[1]}/${m[2]}`,
  },
  logsSliceLogNameSuffix: {
    file: MAIN,
    in: 'main',
    re: /^\s*const suffix = `--\$\{issueNumber\}\.log`;$/gm,
    t: () => '--<issueNumber>.log',
  },
  logsSliceRunName: {
    file: MAIN,
    in: 'main',
    re: /^\s*name: `#\$\{issue\.number\}`,$/gm,
    t: () => '#<issue>',
  },
  logsTraceFlag: {
    file: MAIN,
    in: 'main',
    re: /^const traceSubagents = process\.argv\.includes\('(--trace-subagents)'\);$/gm,
  },
  logsSubagentIndexPath: {
    file: MAIN,
    in: 'main',
    // The dest dir is built once per capture path (live + post-hoc sweep); both must agree
    // or the summary lands somewhere the page does not name.
    re: /^\s*const destDir = join\(\n\s*process\.cwd\(\),\n\s*'\.sandcastle',\n\s*'logs',\n\s*'subagents',\n\s*String\(issue\.number\),\n\s*\);$/gm,
    count: 2,
    t: () => '.sandcastle/logs/subagents/<issue>/index.md',
  },
  logsSubagentSandboxPath: {
    file: MAIN,
    in: 'main',
    re: /^\s*const subagentsDir = join\(\n\s*dirname\(iteration\.sessionFilePath\),\n\s*iteration\.sessionId,\n\s*'subagents',\n\s*\);$/gm,
    t: () => '<sessionId>/subagents/agent-*.jsonl',
  },
  logsSubagentMultiIterationPrefix: {
    file: MAIN,
    in: 'main',
    re: /^\s*\? `iteration-\$\{iterationIndex\}--\$\{fileName\}`$/gm,
    t: () => 'iteration-<index>--',
  },
  logsSessionStoreHostDir: {
    file: MAIN,
    in: 'main',
    re: /^\s*const sessionsDir = join\(process\.cwd\(\), '(\.sandcastle)', '(sessions)'\);$/gm,
    t: (m) => `${m[1]}/${m[2]}`,
  },
  logsSessionStoreSandboxPath: {
    file: MAIN,
    in: 'main',
    re: /^\s*hostPath: sessionsDir,\n\s*sandboxPath: '([^']+)',$/gm,
  },

  // ── waves ──────────────────────────────────────────────────────────────────
  wavesRepo: {
    file: WAVES,
    in: 'waves',
    re: /^const REPO = '([^']+)';$/gm,
  },
  wavesSliceLabel: {
    file: WAVES,
    in: 'waves',
    re: /^\s*'(type:afk)',$/gm,
  },
  wavesSliceListState: {
    file: WAVES,
    in: 'waves',
    re: /^\s*'--state',\n\s*'([a-z]+)',$/gm,
  },
  wavesSliceListLimit: {
    file: WAVES,
    in: 'waves',
    re: /^\s*'--json',\n\s*'number,title,labels,body,state',\n\s*'--limit',\n\s*'(\d+)',$/gm,
    t: num,
  },
  wavesReadyLabel: {
    file: WAVES,
    in: 'waves',
    re: /^\s*const hasReady = s\.labels\.some\(\(l\) => l\.name === '([^']+)'\);$/gm,
  },
  wavesDoneLabel: {
    file: WAVES,
    in: 'waves',
    re: /^\s*issue\.labels\.some\(\(l\) => l\.name === '(status:done)'\)$/gm,
  },
  // dispatch-waves reads edges through the shared parser, so the heading lives there.
  wavesBlockedBySectionHeading: {
    file: SELECTION,
    in: 'selection',
    re: /^\s*return leadingListRefs\(sectionBody\(issue, '(Blocked by)'\)\);$/gm,
    t: (m) => `## ${m[1]}`,
  },
  wavesPlanFlag: {
    file: WAVES,
    in: 'waves',
    re: /^if \(process\.argv\.includes\('(--plan)'\)\) \{$/gm,
  },
  wavesDeferGateFlag: {
    file: WAVES,
    in: 'waves',
    re: /^\s*'(--defer-gate)',$/gm,
  },
  wavesGateOnlyFlag: {
    file: WAVES,
    in: 'waves',
    re: /^\s*'(--gate-only)',$/gm,
  },
};

/** Resolve one source-anchored key, enforcing its expected occurrence count and agreement. */
const resolveSource = (key) => {
  const spec = SOURCE_ASSERTIONS[key];
  if (!spec) return { err: 'no anchored pattern is registered for this key' };
  const text = src[spec.in];
  const matches = [...text.matchAll(spec.re)];
  const want = spec.count ?? 1;
  if (matches.length === 0)
    return {
      err: `the anchored pattern no longer matches anything in ${spec.file} — the source changed shape, so this value is unverifiable`,
    };
  if (matches.length !== want)
    return {
      err: `the anchored pattern matches ${matches.length} place(s) in ${spec.file}, expected ${want} — the fact moved, was copied, or was removed`,
    };
  const t = spec.t ?? first;
  const values = matches.map((m) => JSON.stringify(t(m)));
  if (new Set(values).size > 1)
    return {
      err: `the ${matches.length} occurrences in ${spec.file} disagree: ${[
        ...new Set(values),
      ].join(' vs ')}. Hoist them into one constant.`,
    };
  return { value: t(matches[0]) };
};

// `gateDefaultTargets` is the one fact written twice in DIFFERENT statement shapes: what the
// gate runs, and what the GitHub failure comment tells the maintainer it ran. There is no
// single fact to assert until they share a constant, so assert that both exist and agree.
const resolveGateTargets = () => {
  const runs = [
    ...mainSrc.matchAll(
      /^\s*const targets = \(process\.env\.SLICE_GATE_TARGETS \|\| '([^']*)'\)\.trim\(\);$/gm,
    ),
  ];
  const named = [
    ...mainSrc.matchAll(
      /^\s*\? `the build gate \(\$\{process\.env\.SLICE_GATE_TARGETS \|\| '([^']*)'\}\) failed`$/gm,
    ),
  ];
  if (runs.length !== 1)
    return {
      err: `the gate-targets statement matches ${runs.length} places in ${MAIN}`,
    };
  if (named.length !== 1)
    return {
      err: `the failure-comment targets literal matches ${named.length} places in ${MAIN}`,
    };
  if (runs[0][1] !== named[0][1])
    return {
      err: `the two bare literals in ${MAIN} disagree — the gate runs '${runs[0][1]}' but the GitHub failure comment says '${named[0][1]}'. Hoist them into one constant.`,
    };
  return { value: runs[0][1] };
};

// A duration is stored in milliseconds and read by humans in hours and minutes. The
// guarantee this checker enforces is that the reader can SEE the fact, not that the page
// prints the same digits the source does — so a value may name the rendering that carries
// it. Each entry is a deliberate exemption from the literal-match rule and needs a reason.
const PROSE_ALIASES = {
  // 21_600_000 ms is the wait ceiling; the page says "within 6 hours", which is the fact.
  resumeQuotaMaxWaitMs: ['6 hour'],
  // 300_000 ms is the margin added past a quota reset; the page says "+5 min".
  resumeQuotaWaitMarginMs: ['5 min'],
  orchestratorQuotaWaitMarginMs: ['5 min'],
};

// ── Check every page ─────────────────────────────────────────────────────────

const seenAcrossPages = new Map(); // key -> [{page, value}]

for (const [pagePath, manifestId] of PAGES) {
  const page = readFileSync(pagePath, 'utf8');
  const name = pagePath.split('/').pop();

  const raw = page.match(
    new RegExp(
      `<script type="application/json" id="${manifestId}">([\\s\\S]*?)</script>`,
    ),
  );
  if (!raw) {
    add(name, `no #${manifestId} block — the page cannot be checked`);
    continue;
  }
  let manifest;
  try {
    manifest = JSON.parse(raw[1]);
  } catch (err) {
    add(name, `#${manifestId} is not valid JSON: ${err.message}`);
    continue;
  }

  const exported = manifest.assertedFromExports ?? {};
  const claimedSrc = manifest.assertedFromOrchestratorSource ?? {};
  if (Object.keys(exported).length + Object.keys(claimedSrc).length === 0)
    add(
      name,
      `#${manifestId} asserts nothing — an empty manifest is not a gate`,
    );

  const check = (key, claimed, actual, where) => {
    const a = JSON.stringify(actual);
    const c = JSON.stringify(claimed);
    if (a !== c) add(name, `${key}: page says ${c}, ${where} says ${a}`);
    const prior = seenAcrossPages.get(key) ?? [];
    prior.push({ page: name, value: c });
    seenAcrossPages.set(key, prior);
  };

  for (const [key, claimed] of Object.entries(exported)) {
    const resolver = EXPORT_RESOLVERS[key];
    if (!resolver) {
      add(
        name,
        `assertedFromExports claims ${key}, which this check does not know how to verify`,
      );
      continue;
    }
    let actual;
    try {
      actual = resolver();
    } catch (err) {
      add(name, `${key}: resolver threw — ${err.message}`);
      continue;
    }
    if (actual === undefined) {
      add(
        name,
        `${key}: no longer resolvable from the libs, policy, package.json, or CI`,
      );
      continue;
    }
    check(key, claimed, actual, 'the source');
  }

  for (const [key, claimed] of Object.entries(claimedSrc)) {
    const r =
      key === 'gateDefaultTargets' ? resolveGateTargets() : resolveSource(key);
    if (r.err) {
      add(name, `${key}: ${r.err}`);
      continue;
    }
    check(key, claimed, r.value, SOURCE_ASSERTIONS[key]?.file ?? MAIN);
  }

  // A value that is correct in the manifest but absent from the page body is a fact the
  // reader cannot see. Numbers may be written bare or thousands-grouped; strings must
  // appear as written, allowing for HTML entity escaping.
  const body = page
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '');
  const plain = body
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&');

  const inProse = (v) => {
    if (typeof v === 'number')
      return (
        plain.includes(String(v)) || plain.includes(v.toLocaleString('en-US'))
      );
    if (typeof v === 'string') return plain.includes(v);
    if (Array.isArray(v)) return v.every((x) => inProse(x));
    return true;
  };
  const readable = (key, v) =>
    inProse(v) || (PROSE_ALIASES[key] ?? []).some((a) => plain.includes(a));

  for (const [key, value] of [
    ...Object.entries(exported),
    ...Object.entries(claimedSrc),
  ]) {
    if (!readable(key, value))
      add(
        name,
        `${key}: the manifest carries ${JSON.stringify(
          value,
        )} but the page body never says it — a fact the reader cannot see`,
      );
  }
}

// ── The pages must agree with each other ─────────────────────────────────────
for (const [key, entries] of seenAcrossPages) {
  const distinct = new Set(entries.map((e) => e.value));
  if (distinct.size > 1)
    findings.push(
      `[cross-page] ${key} disagrees between pages: ${entries
        .map((e) => `${e.page}=${e.value}`)
        .join(', ')}`,
    );
}

if (findings.length > 0) {
  console.error(
    `sandcastle-map: ${findings.length} finding(s) — the atlas is out of date\n`,
  );
  for (const f of findings) console.error(`  - ${f}`);
  console.error(
    `\nRead the constants out of ${MAIN}, ${WAVES}, ${RESUME}, ${TRACE} and ${OUTCOME}, then update the page and its manifest.`,
  );
  process.exit(1);
}

console.log(
  `sandcastle-map: OK — ${PAGES.length} pages, ${seenAcrossPages.size} distinct asserted value(s) match their source, agree across pages, and appear in the prose.`,
);
