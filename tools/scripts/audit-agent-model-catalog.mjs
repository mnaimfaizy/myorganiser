#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  parseRetirementTable,
  retirementFindings,
} from './lib/model-retirements.ts';

const repoRoot = process.cwd();
const policyPath = path.join(
  repoRoot,
  'tools',
  'config',
  'agent-model-policy.json',
);
const syncScript = path.join(
  repoRoot,
  'tools',
  'scripts',
  'sync-agent-models.mjs',
);

function parseArgs(argv) {
  const args = argv.slice(2);
  const reportIndex = args.indexOf('--report');
  return {
    online: !args.includes('--offline'),
    printSnapshots: args.includes('--print-snapshots'),
    printSnapshotHashes: args.includes('--print-snapshot-hashes'),
    reportPath:
      reportIndex >= 0 && args[reportIndex + 1]
        ? path.resolve(repoRoot, args[reportIndex + 1])
        : null,
  };
}

function modelsForDisplay(value) {
  return (Array.isArray(value) ? value : [value]).join(' → ');
}

function assignmentTerm(harness, model) {
  if (harness === 'copilot') return model.replace(/\s+\(copilot\)$/, '');
  if (harness === 'cursor') {
    const version = model.match(/\d+(?:\.\d+)*/)?.[0];
    if (model.startsWith('composer-') && version) return `Composer ${version}`;
    if (model.startsWith('grok-') && version) return `Grok ${version}`;
  }
  return model;
}

function assignedTerms(policy, harness) {
  const terms = Object.values(policy.agents).flatMap((entry) => {
    const configured = entry.models[harness];
    return (Array.isArray(configured) ? configured : [configured]).map(
      (model) => assignmentTerm(harness, model),
    );
  });
  return [...new Set(terms)];
}

function htmlToLines(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function catalogSnapshot(lines, prefixes) {
  const normalizedPrefixes = prefixes.map((prefix) => prefix.toLowerCase());
  const candidates = lines
    .flatMap((line, index) => {
      if (line.length > 100) return [];
      if (
        !normalizedPrefixes.some((prefix) =>
          line.toLowerCase().startsWith(prefix),
        )
      ) {
        return [];
      }
      return [
        lines
          .slice(index, index + 3)
          .map((part) => part.replace(/\s+/g, ' ').trim())
          .join(' | '),
      ];
    })
    .filter((line) => !line.startsWith('Gemini API'))
    .sort();
  return snapshotFromCandidates(candidates);
}

function pricingSnapshot(lines, keywords) {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const candidates = lines
    .flatMap((line, index) => {
      if (line.length > 180) return [];
      if (
        !normalizedKeywords.some((keyword) =>
          line.toLowerCase().includes(keyword),
        )
      ) {
        return [];
      }
      return [lines.slice(index, index + 2).join(' | ')];
    })
    .sort();
  return snapshotFromCandidates(candidates);
}

function snapshotFromCandidates(candidates) {
  const unique = [...new Set(candidates)];
  const sha256 = createHash('sha256')
    .update(JSON.stringify(unique))
    .digest('hex');
  return { sha256, candidates: unique };
}

async function fetchDocument(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,text/plain;q=0.9',
          'user-agent': 'myorganiser-agent-model-audit/1.0',
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const lines = htmlToLines(html);
      return {
        lines,
        text: lines.join('\n'),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw lastError;
}

async function fetchSource(source) {
  const document = await fetchDocument(source.url);
  return {
    ...document,
    snapshot: catalogSnapshot(document.lines, source.linePrefixes),
  };
}

function assignmentRows(policy) {
  return Object.entries(policy.agents).map(([slug, entry]) => {
    const models = entry.models;
    return `| ${slug} | ${entry.tier} | ${modelsForDisplay(models.copilot)} | ${modelsForDisplay(models.claude)} | ${modelsForDisplay(models.cursor)} | ${modelsForDisplay(models.gemini)} |`;
  });
}

async function main() {
  const options = parseArgs(process.argv);
  const policy = JSON.parse(await fs.readFile(policyPath, 'utf8'));
  const findings = [];
  const warnings = [];
  const sourceResults = [];
  const runAt = new Date();

  const sync = spawnSync(process.execPath, [syncScript, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (sync.status !== 0) {
    findings.push(
      'Configured model assignments do not match one or more harness frontmatter files.',
    );
  }

  if (options.online) {
    for (const source of policy.catalogSources) {
      try {
        const result = await fetchSource(source);
        const pinnedTerms = assignedTerms(policy, source.harness);
        const trackedTerms = [
          ...new Set([...source.requiredTerms, ...pinnedTerms]),
        ];
        const missingTerms = trackedTerms.filter(
          (term) => !result.text.toLowerCase().includes(term.toLowerCase()),
        );
        for (const term of missingTerms) {
          findings.push(
            `${source.harness}: tracked model or alias "${term}" was not found in the official source.`,
          );
        }
        const retirements = parseRetirementTable(result.lines);
        findings.push(
          ...retirementFindings({
            harness: source.harness,
            assignedTerms: pinnedTerms,
            requiredTerms: source.requiredTerms,
            rows: retirements.rows,
            today: runAt.toISOString().slice(0, 10),
          }),
        );
        if (retirements.tableFound && !retirements.rows.length) {
          warnings.push(
            `${source.harness}: the official source has a retirement table but no row could be read from it; retirements were not checked.`,
          );
        }
        if (
          source.snapshotSha256 &&
          source.snapshotSha256 !== result.snapshot.sha256
        ) {
          findings.push(
            `${source.harness}: the model-catalog snapshot changed (${source.snapshotSha256.slice(0, 12)} → ${result.snapshot.sha256.slice(0, 12)}). Review for launches, removals, or status changes.`,
          );
        }
        if (!source.snapshotSha256) {
          findings.push(
            `${source.harness}: no catalog snapshot baseline is recorded.`,
          );
        }
        sourceResults.push({ label: source.harness, ...result });
      } catch (error) {
        warnings.push(
          `${source.harness}: could not read the official source (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
    }
    for (const [harness, source] of Object.entries(policy.costSources)) {
      try {
        const document = await fetchDocument(source.url);
        const snapshot = pricingSnapshot(document.lines, source.lineKeywords);
        if (
          source.snapshotSha256 &&
          source.snapshotSha256 !== snapshot.sha256
        ) {
          findings.push(
            `${harness}: the pricing snapshot changed (${source.snapshotSha256.slice(0, 12)} → ${snapshot.sha256.slice(0, 12)}). Review rates, credits, included pools, and overage rules.`,
          );
        }
        if (!source.snapshotSha256) {
          findings.push(
            `${harness}: no pricing snapshot baseline is recorded.`,
          );
        }
        sourceResults.push({
          label: `${harness}-pricing`,
          ...document,
          snapshot,
        });
      } catch (error) {
        warnings.push(
          `${harness}: could not read the official pricing source (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
    }
  }

  if (options.printSnapshots || options.printSnapshotHashes) {
    for (const result of sourceResults) {
      const details = options.printSnapshots
        ? `\n${result.snapshot.candidates.join('\n')}`
        : '';
      console.log(`${result.label}: ${result.snapshot.sha256}${details}\n`);
    }
  }

  const report = [
    '# Agent model governance audit',
    '',
    `- Run: ${runAt.toISOString()}`,
    `- Policy reviewed: ${policy.reviewedAt}`,
    `- Assignment sync: ${sync.status === 0 ? 'PASS' : 'FAIL'}`,
    `- Official catalog checks: ${options.online ? 'enabled' : 'disabled'}`,
    `- Findings: ${findings.length}`,
    `- Warnings: ${warnings.length}`,
    '',
    '## Findings',
    '',
    ...(findings.length
      ? findings.map((finding) => `- ${finding}`)
      : [
          '- No assignment drift, removals, retirements, catalog changes, or pricing changes detected.',
        ]),
    '',
    '## Warnings',
    '',
    ...(warnings.length
      ? warnings.map((warning) => `- ${warning}`)
      : ['- None.']),
    '',
    '## Current assignments',
    '',
    '| Agent | Tier | Copilot | Claude | Cursor | Gemini |',
    '| --- | --- | --- | --- | --- | --- |',
    ...assignmentRows(policy),
    '',
    '## Sandcastle defaults',
    '',
    `- Claude low / medium / high: ${policy.orchestrators.sandcastle.claudeByComplexity.low} / ${policy.orchestrators.sandcastle.claudeByComplexity.medium} / ${policy.orchestrators.sandcastle.claudeByComplexity.high}`,
    `- Cursor: ${policy.orchestrators.sandcastle.cursorDefault}`,
    `- Copilot: ${policy.orchestrators.sandcastle.copilotDefault}`,
    '',
    '## Official sources',
    '',
    ...policy.catalogSources.map(
      (source) => `- ${source.harness}: ${source.url}`,
    ),
    ...Object.entries(policy.costSources).map(
      ([harness, source]) => `- ${harness} pricing: ${source.url}`,
    ),
    '',
    '## Cost interpretation',
    '',
    '- Subscription harnesses do not expose one portable dollar-per-session value. Use provider billing exports for actual spend.',
    '- Sandcastle token telemetry can be summarized with `yarn agents:usage:report`; missing provider telemetry remains explicitly unknown.',
    '- Model-catalog and pricing changes are reported for human review. This audit never rewrites model assignments automatically.',
    '',
  ].join('\n');

  if (options.reportPath) {
    await fs.mkdir(path.dirname(options.reportPath), { recursive: true });
    await fs.writeFile(options.reportPath, report, 'utf8');
  }
  console.log(report);

  if (findings.length) process.exitCode = 1;
  else if (warnings.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
