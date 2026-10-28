/**
 * dispatch-waves — autonomous, dependency-aware driver around dispatch-agents.
 *
 * The base orchestrator (.sandcastle/main.mts) dispatches a PRD's ready AFK slices
 * ONE BY ONE, each branched from the CURRENT local feature head, and fast-forwards
 * every finished slice into the LOCAL feature branch (no push, no PR). Within a
 * single run, a slice already sees the work of every earlier slice in that run.
 *
 * This driver adds explicit dependency ORDERING across runs: it topologically sorts
 * the PRD's slices by their `## Blocked by` sections into dependency waves, then runs
 * ONE dispatch-agents pass per wave — gating the `ready-for-agent` label so only the
 * current wave is picked up. Each wave's integrated output (on the local feature
 * branch) becomes the base for the next wave. No human interaction between waves.
 *
 * Nothing is pushed and no PRs are opened — after all waves complete you QA the
 * local feature branch, then open ONE PR to `main` through `ai:create-pr`.
 *
 * Usage: npx tsx .sandcastle/dispatch-waves.mts --prd <issue-number>
 */
import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { planWaveForwarding } from '../tools/scripts/lib/sandcastle-resume.ts';
import {
  blockedBy,
  findDependencyCycles,
  formatCycle,
} from '../tools/scripts/lib/sandcastle-slice-selection.ts';

dotenv.config({ path: join(process.cwd(), '.sandcastle', '.env') });

const REPO = 'mnaimfaizy/myorganiser';

function fail(message: string, code = 1): never {
  console.error(`\nError: ${message}`);
  process.exit(code);
}

function printHelp(): void {
  console.log(`
Usage:
  npx tsx .sandcastle/dispatch-waves.mts --prd <issue-number> [--agent claude|cursor|copilot] [--model <model>]

Flags:
  --prd <issue-number>   PRD issue number to dispatch
  --agent <name>         Forwarded to dispatch-agents
  --model <model>        Forwarded to dispatch-agents
  --plan                 Preview wave ordering only
  (the build gate runs ONCE at the end, on the assembled feature branch, and
   never blocks a wave — see ADR 0045)
  (--fresh is refused here — discard one slice with dispatch-agents instead)
  --help                 Show this help text

Environment:
  .sandcastle/.env is loaded automatically.
`);
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

// ─── Parse --prd <N> ─────────────────────────────────────────────────────────

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const prdFlag = process.argv.indexOf('--prd');
if (prdFlag === -1 || !process.argv[prdFlag + 1]) {
  fail('Usage: npx tsx .sandcastle/dispatch-waves.mts --prd <issue-number>');
}
const prdNumber = parseInt(process.argv[prdFlag + 1], 10);
if (isNaN(prdNumber)) fail('--prd must be a number.');

// Everything this driver does not own itself forwards to the orchestrator — except
// the discard flag, which it refuses outright. A discard is a surgical instruction
// about ONE inspected attempt; a wave run spans every slice in the PRD, so forwarding
// it would destroy checkpoints across the whole feature. See ADR 0035.
const forwarding = planWaveForwarding(process.argv);
if (!forwarding.ok) fail(forwarding.message);
const forwardedArgs: string[] = forwarding.forwarded;

// ─── Fetch all AFK slices for this PRD ────────────────────────────────────────

type Issue = {
  number: number;
  title: string;
  labels: Array<{ name: string }>;
  body: string;
  state: string;
};

function fetchSlices(): Issue[] {
  // --state all: the orchestrator CLOSES a slice on successful integration, so a
  // completed slice must still be visible here (for blocker resolution and wave
  // verification). isDone() below treats a closed slice as complete.
  const all = ghJson<Issue[]>([
    'issue',
    'list',
    '--repo',
    REPO,
    '--label',
    'type:afk',
    '--state',
    'all',
    '--json',
    'number,title,labels,body,state',
    '--limit',
    '100',
  ]);
  return all.filter((i) => i.body?.includes(`PRD: #${prdNumber}`));
}

const slices = fetchSlices();
if (slices.length === 0) {
  fail(
    `No open AFK slice issues found for PRD #${prdNumber}.\n` +
      `Flip any HITL slices to type:afk, or run /to-issues ${prdNumber} first.`,
  );
}

const sliceNumbers = new Set(slices.map((s) => s.number));

// ─── Parse `## Blocked by` → dependency edges (within this PRD only) ──────────

function blockersOf(issue: Issue): number[] {
  // The shared parser reads only the reference each list item leads with, so a
  // note in the section ("not blocked by #771") is not mistaken for an edge.
  // Only count blockers that are themselves slices of this PRD.
  return blockedBy(issue).filter(
    (n: number) => sliceNumbers.has(n) && n !== issue.number,
  );
}

const blockers = new Map<number, number[]>();
for (const s of slices) blockers.set(s.number, blockersOf(s));

// ─── Topological sort into waves (Kahn, level by level) ───────────────────────

function computeWaves(): number[][] {
  const remaining = new Set(sliceNumbers);
  const resolved = new Set<number>();
  const waves: number[][] = [];

  while (remaining.size > 0) {
    const wave = [...remaining]
      .filter((n) => blockers.get(n)!.every((b) => resolved.has(b)))
      .sort((a, b) => a - b);

    if (wave.length === 0) {
      const cycles = findDependencyCycles(
        slices.filter((s) => remaining.has(s.number)),
      );
      fail(
        cycles.length > 0
          ? `Dependency cycle among slices: ${cycles.map(formatCycle).join('; ')}.\n` +
              'Correct the `## Blocked by` sections, then re-run.'
          : `Unsatisfiable blocker among slices: ${[...remaining].join(', ')}`,
      );
    }
    for (const n of wave) {
      remaining.delete(n);
      resolved.add(n);
    }
    waves.push(wave);
  }
  return waves;
}

const waves = computeWaves();

function isDone(issue: Issue): boolean {
  // A slice is complete if it carries status:done OR has been closed (the
  // orchestrator closes slices on successful local integration).
  return (
    issue.state === 'CLOSED' ||
    issue.labels.some((l) => l.name === 'status:done')
  );
}

// ─── Plan summary ─────────────────────────────────────────────────────────────

const byNumber = new Map(slices.map((s) => [s.number, s]));
console.log(`\nPRD #${prdNumber} — autonomous wave dispatch`);
console.log(`${waves.length} wave(s), ${slices.length} slice(s):\n`);
waves.forEach((wave, i) => {
  const labels = wave
    .map((n) => `#${n}${isDone(byNumber.get(n)!) ? ' (done)' : ''}`)
    .join(', ');
  console.log(`  Wave ${i + 1}: ${labels}`);
});
console.log();

if (process.argv.includes('--plan')) {
  console.log('--plan: preview only, no slices dispatched.\n');
  process.exit(0);
}

// ─── Run each wave ─────────────────────────────────────────────────────────────

const incompleteByWave: Array<{ wave: number; slices: number[] }> = [];

for (let i = 0; i < waves.length; i++) {
  const wave = waves[i];
  // Re-fetch to pick up status changes from prior waves / prior runs.
  const current = fetchSlices();
  const currentByNumber = new Map(current.map((s) => [s.number, s]));

  const openInWave = wave.filter((n) => {
    const issue = currentByNumber.get(n);
    return issue && !isDone(issue);
  });

  if (openInWave.length === 0) {
    console.log(`\n=== Wave ${i + 1} — already complete, skipping. ===`);
    continue;
  }

  console.log(
    `\n=== Wave ${i + 1}/${waves.length}: dispatching ${openInWave
      .map((n) => `#${n}`)
      .join(', ')} ===\n`,
  );

  // Gate labels: ONLY this wave's open slices are ready-for-agent. Remove the
  // label from every other PRD slice (future waves AND already-done slices) so
  // the orchestrator's open+ready+afk filter cannot re-dispatch them.
  for (const s of current) {
    const wantReady = openInWave.includes(s.number);
    const hasReady = s.labels.some((l) => l.name === 'ready-for-agent');
    if (wantReady && !hasReady) {
      ghSilent([
        'issue',
        'edit',
        String(s.number),
        '--repo',
        REPO,
        '--add-label',
        'ready-for-agent',
      ]);
    } else if (!wantReady && hasReady) {
      ghSilent([
        'issue',
        'edit',
        String(s.number),
        '--repo',
        REPO,
        '--remove-label',
        'ready-for-agent',
      ]);
    }
  }

  // Invoke the existing orchestrator. It branches each ready slice from the
  // (now updated) local feature branch, runs the agent, and fast-forwards the
  // slice into the local feature branch.
  const dispatch = spawnSync(
    'npx',
    [
      'tsx',
      '.sandcastle/main.mts',
      '--prd',
      String(prdNumber),
      // Gate once, after the LAST wave — not once per wave. See ADR 0045.
      '--defer-gate',
      ...forwardedArgs,
    ],
    { encoding: 'utf8', stdio: 'inherit', windowsHide: true, shell: true },
  );
  if (dispatch.status !== 0) {
    fail(
      `Wave ${i + 1} orchestrator exited with code ${dispatch.status}. ` +
        `Inspect the feature branch and slice issues before re-running.`,
    );
  }

  // Verify every slice in this wave reached status:done before proceeding —
  // a dependent wave must not branch off an incomplete base.
  const after = fetchSlices();
  const afterByNumber = new Map(after.map((s) => [s.number, s]));
  const failedSlices = openInWave.filter((n) => {
    const issue = afterByNumber.get(n);
    return !issue || !isDone(issue);
  });

  if (failedSlices.length > 0) {
    // Record and CARRY ON. Aborting here is what turned an unattended PRD into a
    // wasted night: wave 1 stalls, waves 2 and 3 never run, and nothing at all is
    // integrated — twice, on gate faults unrelated to the code. Later waves may
    // depend on this one and may well fail too; a failed wave that reports is still
    // strictly more useful than a PRD that stopped. See ADR 0045.
    incompleteByWave.push({ wave: i + 1, slices: failedSlices });
    console.error(
      `\n=== Wave ${i + 1} incomplete: ${failedSlices
        .map((n) => `#${n}`)
        .join(', ')} — continuing to the next wave. ===\n` +
        `    Later waves that depend on these may fail too; everything is reported at the end.`,
    );
    continue;
  }

  console.log(`\n=== Wave ${i + 1} complete. ===`);
}

// ─── One gate for the whole PRD ───────────────────────────────────────────────
// Every wave ran with --defer-gate, so nothing has been gated yet. Gate the
// assembled feature branch once, here — the only scope that can see two slices
// breaking each other, and the same scope CI will run on the PR. It does not
// block: the slices are already integrated and the point of this run is to leave
// a verdict a maintainer can read in the morning. See ADR 0045.
console.log(`\n${'─'.repeat(55)}`);
console.log(
  `All ${waves.length} wave(s) attempted for PRD #${prdNumber}. Gating once...\n`,
);

const gate = spawnSync(
  'npx',
  [
    'tsx',
    '.sandcastle/main.mts',
    '--prd',
    String(prdNumber),
    '--gate-only',
    ...forwardedArgs,
  ],
  { encoding: 'utf8', stdio: 'inherit', windowsHide: true, shell: true },
);
const gateOk = gate.status === 0;

// Slices whose run did not end clean: integrated and status:done, so the waves
// above counted them, but held open as ready-for-human with what they left (ADR
// 0111). The PRD is not finished while any remain, whatever the gate says.
const heldSlices = fetchSlices()
  .filter(
    (s) =>
      s.state !== 'CLOSED' &&
      s.labels.some((l) => l.name === 'ready-for-human'),
  )
  .map((s) => s.number)
  .sort((a, b) => a - b);

console.log(`\n${'─'.repeat(55)}`);
console.log(`PRD #${prdNumber} — run summary\n`);
console.log(`  waves attempted   ${waves.length}`);
console.log(
  `  incomplete waves  ${
    incompleteByWave.length === 0
      ? 'none'
      : incompleteByWave
          .map(
            (w) =>
              `wave ${w.wave} (${w.slices.map((n) => `#${n}`).join(', ')})`,
          )
          .join('; ')
  }`,
);
console.log(
  `  held for a person ${
    heldSlices.length === 0 ? 'none' : heldSlices.map((n) => `#${n}`).join(', ')
  }`,
);
console.log(`  feature gate      ${gateOk ? 'PASS' : 'FAIL'}`);
console.log(
  `\nNothing is pushed and nothing was discarded. Every slice branch is intact.`,
);

const needsAttention =
  !gateOk || incompleteByWave.length > 0 || heldSlices.length > 0;

if (needsAttention) {
  console.log(
    `\nThis run needs attention, but it did NOT stop early — later waves still ran.\n` +
      `The gate verdict is also on PRD #${prdNumber} as a comment, so it reaches you\n` +
      `without the terminal. Re-running skips slices already marked status:done.`,
  );
  if (heldSlices.length > 0) {
    console.log(
      `\nEach held slice carries a comment listing what it left undone. Resolve it,\n` +
        `then close the issue: that releases the slices blocked behind it for the next run.`,
    );
  }
} else {
  console.log(
    `\nThe local feature branch contains every slice and is green. QA it, then open\n` +
      `ONE PR to main through the create-pull-request-workflow Skill:\n` +
      `  PrAuthor drafts it; \`corepack yarn ai:create-pr --title <t> --body-file <f> --merge-base <sha>\` pushes and opens it.`,
  );
}

process.exit(needsAttention ? 1 : 0);
