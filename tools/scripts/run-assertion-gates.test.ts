import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GATE_MANIFEST,
  type GateManifestEntry,
  type GateSpawn,
  runGateManifest,
} from './lib/gate-manifest.ts';
import { createGateManifestWorkspace } from './lib/gate-manifest-test-workspace.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(
  dirname(fileURLToPath(import.meta.url)),
  'run-assertion-gates.ts',
);
const STUB_SCRIPT = 'tools/scripts/check-stub.mjs';

// ADR 0043: each `corepack yarn` line costs ~1.3s of overhead against ~350ms
// of work. Issue #735: a 5000ms wall-clock cap on the whole aggregate is
// platform-sensitive and roster-sensitive, so it went red on Windows while
// the property it was defending stayed healthy.
//
// The bound is calibrated in the same run and environment as the measurement:
// a bare `node -e 0` spawn, which is what the aggregate pays per checker, and
// a bare `corepack yarn node -e 0` line, which is what the rejected shape pays.
// Per-checker cost fails once it is more than halfway from the first to the
// second. There is no constant and no platform branch.
//
// Two fixed figures came before this, and each failed somewhere:
// - The bound was 8× a bare spawn, placed below ADR 0043's 1.3s yarn line over
//   issue #735's 96ms Windows spawn (13.5×). On a macOS host a warm yarn line
//   measured 237ms against a 36ms spawn, 6.6×, so one yarn line per checker
//   passed the bound it existed to fail.
// - The timed run was the real roster, so the cost included checker work, which
//   reads the repo. In the sandcastle sandbox the repo is a VirtioFS bind mount
//   while a bare spawn reads only the image: one cold run measured a 14ms spawn
//   against 824ms per checker (57×), warm runs 6.6–7.8×, and slice #1328 hit
//   9.9×, against 3.4× on the host. A yarn line does that same work, so ADR
//   0043's argument is about overhead alone. The aggregate is timed over stub
//   checkers in a temp workspace instead; the real roster's correctness is
//   the first test's job.

interface SpawnLikeResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function averageSpawnMs(spawn: () => SpawnLikeResult, rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i += 1) {
    const startedAt = performance.now();
    const result = spawn();
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    total += performance.now() - startedAt;
  }
  return total / rounds;
}

// Through a shell, as `.husky/pre-commit` runs it, and so Windows resolves
// `corepack.cmd`. From the repo root, so Yarn reads this checkout's install.
function spawnYarnLine(command: string) {
  return spawnSync(`corepack yarn ${command}`, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: true,
  });
}

interface Calibration {
  baselineMs: number;
  boundMs: number;
  describe: (perCheckerMs: number) => string;
}

function calibrate(): Calibration {
  const baselineMs = averageSpawnMs(
    () => spawnSync(process.execPath, ['-e', '0'], { encoding: 'utf8' }),
    5,
  );
  const yarnLineMs = averageSpawnMs(() => spawnYarnLine('node -e 0'), 3);
  assert.ok(
    yarnLineMs > baselineMs,
    `a yarn line (${yarnLineMs.toFixed(0)}ms) must cost more than the bare ` +
      `spawn it wraps (${baselineMs.toFixed(0)}ms)`,
  );
  const boundMs = baselineMs + (yarnLineMs - baselineMs) / 2;
  const describe = (perCheckerMs: number) =>
    `${perCheckerMs.toFixed(0)}ms per checker against a bound of ` +
    `${boundMs.toFixed(0)}ms, halfway from a ${baselineMs.toFixed(0)}ms ` +
    `node spawn to a ${yarnLineMs.toFixed(0)}ms yarn line`;
  return { baselineMs, boundMs, describe };
}

function stubManifest(count: number): GateManifestEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `stub-${i}`,
    npmScript: `stub-${i}:check`,
    script: STUB_SCRIPT,
    args: [],
  }));
}

function perCheckerMs(
  manifest: readonly GateManifestEntry[],
  options: { cwd: string; spawn?: GateSpawn },
): number {
  const startedAt = performance.now();
  const results = runGateManifest(manifest, options);
  const elapsedMs = performance.now() - startedAt;
  assert.ok(
    results.every((result) => result.status === 0),
    results.map((result) => `${result.stdout}${result.stderr}`).join('\n'),
  );
  return elapsedMs / manifest.length;
}

test('the aggregate runs every gate against the real repo and exits 0', () => {
  const result = spawnSync(process.execPath, [RUNNER], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  // Read from the manifest rather than listed here. A hand-copied mirror of the
  // roster is what rotted in design-page-roster.ts, and a literal count is what
  // made adding the fourteenth checker fail a test about nothing.
  for (const { id } of GATE_MANIFEST) {
    assert.ok(
      result.stdout.includes(`✓ ${id}`),
      `${id} did not report a pass:\n${result.stdout}`,
    );
  }
  const total = GATE_MANIFEST.length;
  assert.match(result.stdout, new RegExp(`${total}/${total} checks passed`));
});

// Guards the aggregate decision itself: replacing it with one `corepack yarn`
// line per checker would cost a yarn line of overhead per check (ADR 0043).
// The runner and its manifest check against package.json run unchanged; only
// the checkers it spawns are stubs, so what is timed is the aggregate shape.
test('the aggregate stays well under a yarn-line per-checker cost', (t) => {
  const workspace = createGateManifestWorkspace(t, {
    prefix: 'gate-aggregate-',
    scripts: [...new Set(GATE_MANIFEST.map(({ script }) => script))],
  });
  copyFileSync(
    join(REPO_ROOT, 'package.json'),
    join(workspace, 'package.json'),
  );

  const { boundMs, describe } = calibrate();
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [RUNNER], {
    cwd: workspace,
    encoding: 'utf8',
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const costMs = elapsedMs / GATE_MANIFEST.length;
  assert.ok(
    costMs < boundMs,
    `expected the aggregate well under the corepack-yarn shape; took ` +
      `${describe(costMs)} (${GATE_MANIFEST.length} checkers)`,
  );
});

// The bound must fail the shape it guards against, measured the same way.
// Three checkers suffice: per-checker cost does not depend on roster size.
test('a yarn line per checker fails the bound', (t) => {
  const workspace = createGateManifestWorkspace(t, {
    prefix: 'gate-yarn-line-',
    scripts: [STUB_SCRIPT],
  });

  const { boundMs, describe } = calibrate();
  const costMs = perCheckerMs(stubManifest(3), {
    cwd: workspace,
    spawn: (entry, cwd) => {
      const result = spawnYarnLine(
        `node ${JSON.stringify(join(cwd, entry.script))}`,
      );
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    },
  });

  assert.ok(
    costMs > boundMs,
    `expected a yarn line per checker to exceed the bound; took ` +
      describe(costMs),
  );
});

test('per-checker cost does not rise when the roster grows', (t) => {
  const workspace = createGateManifestWorkspace(t, {
    prefix: 'gate-roster-',
    scripts: [STUB_SCRIPT],
  });

  const largeN = GATE_MANIFEST.length;
  const smallN = Math.max(2, Math.floor(largeN / 2));
  const { baselineMs, boundMs, describe } = calibrate();

  const costSmall = perCheckerMs(stubManifest(smallN), { cwd: workspace });
  const costLarge = perCheckerMs(stubManifest(largeN), { cwd: workspace });

  assert.ok(
    costSmall < boundMs,
    `small roster (${smallN}) took ${describe(costSmall)}`,
  );
  assert.ok(
    costLarge < boundMs,
    `large roster (${largeN}) took ${describe(costLarge)}`,
  );
  assert.ok(
    costLarge <= costSmall + baselineMs,
    `adding checkers must not consume bound headroom: ` +
      `${costSmall.toFixed(0)}ms per checker at n=${smallN} vs ` +
      `${costLarge.toFixed(0)}ms at n=${largeN} ` +
      `(slack one ${baselineMs.toFixed(0)}ms spawn)`,
  );
});
