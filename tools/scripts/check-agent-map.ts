#!/usr/bin/env node
// Asserts that docs/agents/orchestration-map.html still describes the fleet it claims to.
//
//   node tools/scripts/check-agent-map.ts
//
// The page is a hand-designed diagram, so its prose cannot be generated. What can be checked
// is its roster: the embedded manifest must agree with tools/config/agent-model-policy.json,
// and every agent in the manifest must actually appear in the diagram. A policy change that
// leaves the page behind fails here rather than becoming a confidently wrong reference.
//
// Exit 0 = in sync. Exit 1 = drift (fix the page). Exit 2 = the check could not run.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_MAP_MANIFEST_NOTE } from './lib/agent-map-manifest-note.ts';

const PAGE = 'docs/agents/orchestration-map.html';
const JOURNEY = 'docs/agents/agent-journey.html';
const POLICY = 'tools/config/agent-model-policy.json';
const AGENTS_DIR = '.github/agents';

const fail: (msg: string) => never = (msg) => {
  console.error(`agent-map: ${msg}`);
  process.exit(2);
};

if (!existsSync(PAGE)) fail(`${PAGE} not found`);
if (!existsSync(POLICY)) fail(`${POLICY} not found`);

const page = readFileSync(PAGE, 'utf8');
/** The policy file as it arrives: untrusted JSON, read field by field. */
interface AgentModelPolicy {
  agents: Record<string, { tier?: unknown }>;
  reviewedAt?: unknown;
}

/** The manifest block embedded in the page: untrusted JSON, same treatment. */
interface AgentMapManifest {
  agents?: Record<string, unknown>;
  policyReviewedAt?: unknown;
  note?: unknown;
}

const policy = JSON.parse(readFileSync(POLICY, 'utf8')) as AgentModelPolicy;

function readManifest(html: string, path: string): AgentMapManifest {
  const raw = html.match(
    /<script type="application\/json" id="agent-map-manifest">([\s\S]*?)<\/script>/,
  );
  if (!raw)
    fail(
      `no #agent-map-manifest block in ${path} — edit the page in place via design-brief → Designer (ADR 0046); build-agent-map.ts is not a rebuild path`,
    );
  try {
    return JSON.parse(raw[1]) as AgentMapManifest;
  } catch (err) {
    fail(
      `#agent-map-manifest in ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const manifest = readManifest(page, PAGE);

// Policy keys are kebab file stems; the diagram labels agents by their frontmatter `name`.
const displayNames = Object.fromEntries(
  readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.agent.md'))
    .map((f): [string, string] => {
      const name = readFileSync(join(AGENTS_DIR, f), 'utf8').match(
        /^name:\s*(.+)$/m,
      );
      if (!name) fail(`${f} has no name: in its frontmatter`);
      // Frontmatter quotes its values; the diagram labels agents bare.
      return [
        f.replace('.agent.md', ''),
        name[1].trim().replace(/^['"]|['"]$/g, ''),
      ];
    }),
);

const expected = Object.fromEntries(
  Object.entries(policy.agents).map(([key, v]): [string, unknown] => [
    displayNames[key] ?? key,
    v.tier,
  ]),
);
const claimed: Record<string, unknown> = manifest.agents ?? {};
const findings: string[] = [];

for (const [name, tier] of Object.entries(expected)) {
  if (!(name in claimed)) {
    findings.push(`missing from the page: ${name} (${tier})`);
  } else if (claimed[name] !== tier) {
    findings.push(
      `tier drift: ${name} is ${tier} in policy, ${claimed[name]} on the page`,
    );
  }
}
for (const name of Object.keys(claimed)) {
  if (!(name in expected))
    findings.push(`page lists an agent the policy does not: ${name}`);
}

// A manifest entry that never appears in the diagram body is a roster the reader cannot see.
for (const name of Object.keys(claimed)) {
  if (!page.includes(`>${name}<`) && !page.includes(`data-agent="${name}"`)) {
    findings.push(
      `${name} is in the manifest but never rendered in the diagram`,
    );
  }
}

function checkReviewedAt(manifest: AgentMapManifest, path: string): void {
  if (manifest.policyReviewedAt !== policy.reviewedAt) {
    findings.push(
      `policy reviewedAt moved: ${path} says ${manifest.policyReviewedAt}, policy says ${policy.reviewedAt}`,
    );
  }
}

function checkManifestNote(manifest: AgentMapManifest, path: string): void {
  if (manifest.note !== AGENT_MAP_MANIFEST_NOTE) {
    findings.push(
      `manifest note drift: ${path} note does not match tools/scripts/lib/agent-map-manifest-note.ts`,
    );
  }
}

checkReviewedAt(manifest, PAGE);
checkManifestNote(manifest, PAGE);

// The journey page carries its own #agent-map-manifest block — the same shape as the
// orchestration map's — and its policyReviewedAt drifts independently of it. It also
// hard-codes a tier per station in its own script, independent of either manifest. Those
// are what a reader actually sees on the rail, so they get checked against the policy too.
if (existsSync(JOURNEY)) {
  const journey = readFileSync(JOURNEY, 'utf8');
  const journeyManifest = readManifest(journey, JOURNEY);
  checkReviewedAt(journeyManifest, JOURNEY);
  checkManifestNote(journeyManifest, JOURNEY);
  const stations = [
    ...journey.matchAll(/name\s*:\s*'([^']+)'\s*,\s*tier\s*:\s*'(T[012])'/g),
  ];
  if (stations.length === 0) {
    findings.push(
      `${JOURNEY} declares no station tiers — did its script change shape?`,
    );
  }
  for (const [, name, tier] of stations) {
    if (!(name in expected)) continue; // stations also cover non-agents (Lint gate, Human, …)
    if (expected[name] !== tier) {
      findings.push(
        `tier drift in the journey: ${name} is ${expected[name]} in policy, ${tier} on the rail`,
      );
    }
  }
}

if (findings.length > 0) {
  console.error(
    `agent-map: ${findings.length} finding(s) — the agent docs are out of date\n`,
  );
  for (const f of findings) console.error(`  - ${f}`);
  console.error(
    `\nUpdate the diagrams in place via design-brief → Designer (ADR 0046) to match ${POLICY}.`,
  );
  process.exit(1);
}

console.log(
  `agent-map: OK — ${Object.keys(expected).length} agents, tiers match ${POLICY} (reviewed ${policy.reviewedAt})`,
);
