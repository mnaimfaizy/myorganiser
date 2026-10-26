import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AGENT_MAP_MANIFEST_NOTE } from './lib/agent-map-manifest-note.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-agent-map.mjs');

const PAGE = 'docs/agents/orchestration-map.html';
const JOURNEY = 'docs/agents/agent-journey.html';
const POLICY = 'tools/config/agent-model-policy.json';

function write(workspace, relative, contents) {
  const path = join(workspace, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function manifestBlock(
  policyReviewedAt,
  agents,
  note = AGENT_MAP_MANIFEST_NOTE,
) {
  return `<script type="application/json" id="agent-map-manifest">
${JSON.stringify({ note, policyReviewedAt, agents }, null, 2)}
</script>`;
}

/** A minimal, valid fixture: one agent, both pages agreeing with the policy. */
function scaffold(
  t,
  {
    pageReviewedAt = '2026-09-03',
    journeyReviewedAt = '2026-09-03',
    omitJourneyManifest = false,
  } = {},
) {
  const workspace = mkdtempSync(join(tmpdir(), 'agent-map-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  write(
    workspace,
    POLICY,
    JSON.stringify({
      reviewedAt: '2026-09-03',
      agents: { 'test-agent': { tier: 'T1' } },
    }),
  );

  write(
    workspace,
    '.github/agents/test-agent.agent.md',
    `---\nname: TestAgent\n---\nBody.\n`,
  );

  write(
    workspace,
    PAGE,
    `<!doctype html><html><head>
${manifestBlock(pageReviewedAt, { TestAgent: 'T1' })}
</head><body><div>TestAgent</div></body></html>`,
  );

  const journeyManifest = omitJourneyManifest
    ? ''
    : manifestBlock(journeyReviewedAt, { TestAgent: 'T1' });
  write(
    workspace,
    JOURNEY,
    `<!doctype html><html><head>
${journeyManifest}
</head><body>
<script>var stations = [{ id:'a', name:'TestAgent', tier:'T1' }];</script>
</body></html>`,
  );

  return workspace;
}

const run = (workspace) =>
  spawnSync(process.execPath, [CHECKER], { cwd: workspace, encoding: 'utf8' });

test('passes when both pages agree with the policy', (t) => {
  const workspace = scaffold(t);
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK — 1 agents/);
});

// The reproduction from issue #476: the journey page's own policyReviewedAt drifts from
// the policy while the orchestration map stays correct. Before this fix, check-agent-map.mjs
// read no manifest field from the journey page but its hard-coded station tiers, so this
// drift passed silently.
test('fails when only the journey page manifest date drifts from the policy', (t) => {
  const workspace = scaffold(t, { journeyReviewedAt: '2026-01-01' });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /policy reviewedAt moved: docs\/agents\/agent-journey\.html says 2026-01-01, policy says 2026-09-03/,
  );
});

test('fails when only the orchestration map manifest date drifts from the policy', (t) => {
  const workspace = scaffold(t, { pageReviewedAt: '2026-01-01' });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /policy reviewedAt moved: docs\/agents\/orchestration-map\.html says 2026-01-01, policy says 2026-09-03/,
  );
});

test('fails when a page manifest note drifts from the shared constant', (t) => {
  const workspace = scaffold(t);
  write(
    workspace,
    PAGE,
    `<!doctype html><html><head>
${manifestBlock('2026-09-03', { TestAgent: 'T1' }, 'stale note')}
</head><body><div>TestAgent</div></body></html>`,
  );
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /manifest note drift: docs\/agents\/orchestration-map\.html note does not match/,
  );
});

test('cannot run when the journey page has no #agent-map-manifest block', (t) => {
  const workspace = scaffold(t, { omitJourneyManifest: true });
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /no #agent-map-manifest block in docs\/agents\/agent-journey\.html/,
  );
});
