#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { errorMessage } from './lib/error-message.ts';

const repoRoot = process.cwd();
const policyPath = path.join(
  repoRoot,
  'tools',
  'config',
  'agent-model-policy.json',
);

interface HarnessPathConfig {
  dir: string;
  fileName: (slug: string) => string;
}

const HARNESS_PATHS: Record<string, HarnessPathConfig> = {
  copilot: {
    dir: path.join(repoRoot, '.github', 'agents'),
    fileName: (slug) => `${slug}.agent.md`,
  },
  claude: {
    dir: path.join(repoRoot, '.claude', 'agents'),
    fileName: (slug) => `${slug}.md`,
  },
  cursor: {
    dir: path.join(repoRoot, '.cursor', 'agents'),
    fileName: (slug) => `${slug}.md`,
  },
  gemini: {
    dir: path.join(repoRoot, '.gemini', 'agents'),
    fileName: (slug) => `${slug}.md`,
  },
};

/** The subset of `tools/config/agent-model-policy.json` this sync reads. */
interface AgentModelPolicy {
  schemaVersion: number;
  agents: Record<string, { models: Record<string, string | string[]> }>;
}

function parseMode(argv: string[]): 'apply' | 'check' {
  const args = new Set(argv.slice(2));
  if (args.has('--apply')) return 'apply';
  if (args.has('--check')) return 'check';
  throw new Error(
    'Usage: node tools/scripts/sync-agent-models.ts --check|--apply',
  );
}

function formatModel(model: string | string[]): string {
  if (Array.isArray(model)) {
    return `[${model.map((value) => `'${value}'`).join(', ')}]`;
  }
  return model;
}

function replaceModel(content: string, expected: string | string[]): string {
  const modelPattern = /^model:\s*(.*)$/m;
  const match = content.match(modelPattern);
  if (!match) {
    throw new Error('missing model frontmatter');
  }
  if (!match[1].trim()) {
    throw new Error(
      'multiline model frontmatter is unsupported; use a single-line value',
    );
  }
  return content.replace(modelPattern, `model: ${formatModel(expected)}`);
}

async function readPolicy(): Promise<AgentModelPolicy> {
  const content = await fs.readFile(policyPath, 'utf8');
  const policy = JSON.parse(content) as AgentModelPolicy;
  if (policy.schemaVersion !== 1 || !policy.agents) {
    throw new Error(`Unsupported model policy schema in ${policyPath}`);
  }
  return policy;
}

async function canonicalSlugs(): Promise<string[]> {
  const dir = HARNESS_PATHS.copilot.dir;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.agent.md'))
    .map((entry) => entry.name.replace(/\.agent\.md$/, ''))
    .sort();
}

function validateCoverage(policy: AgentModelPolicy, slugs: string[]): void {
  const configured = Object.keys(policy.agents).sort();
  const missing = slugs.filter((slug) => !configured.includes(slug));
  const extra = configured.filter((slug) => !slugs.includes(slug));
  if (missing.length || extra.length) {
    const details = [
      missing.length ? `missing policy entries: ${missing.join(', ')}` : '',
      extra.length ? `unknown policy entries: ${extra.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(`Agent model policy coverage is incomplete: ${details}`);
  }
}

async function main() {
  const mode = parseMode(process.argv);
  const policy = await readPolicy();
  const slugs = await canonicalSlugs();
  validateCoverage(policy, slugs);

  const drifted: string[] = [];
  const updated: string[] = [];

  for (const slug of slugs) {
    for (const [harness, config] of Object.entries(HARNESS_PATHS)) {
      const expected = policy.agents[slug].models[harness];
      if (!expected) {
        throw new Error(`No ${harness} model configured for ${slug}`);
      }

      const filePath = path.join(config.dir, config.fileName(slug));
      const relativePath = path.relative(repoRoot, filePath);
      const content = await fs.readFile(filePath, 'utf8');
      let desired: string;
      try {
        desired = replaceModel(content, expected);
      } catch (error) {
        throw new Error(`${relativePath}: ${errorMessage(error)}`);
      }

      if (desired === content) continue;
      drifted.push(relativePath);
      if (mode === 'apply') {
        await fs.writeFile(filePath, desired, 'utf8');
        updated.push(relativePath);
      }
    }
  }

  console.log(`Sub-agent model sync mode: ${mode}`);
  console.log(`  policy: ${path.relative(repoRoot, policyPath)}`);
  console.log(`  assignments checked: ${slugs.length * 4}`);
  console.log(`  drifted: ${drifted.length}`);
  if (mode === 'apply') console.log(`  updated: ${updated.length}`);
  for (const file of drifted) console.log(`    ~ ${file}`);

  if (mode === 'check' && drifted.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
