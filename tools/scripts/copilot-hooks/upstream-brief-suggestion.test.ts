/**
 * Tests for upstream-brief-suggestion module.
 *
 * Uses Node's built-in test runner (node --test).
 * Run with: node --test tools/scripts/copilot-hooks/upstream-brief-suggestion.test.ts
 *
 * Version comparison and range parsing live in the skill
 * (`.agents/skills/upstream-brief/{report,ledger}.mjs`); this suite covers
 * the hook's suggestion decision, not a second copy of that grammar.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkEcosystemBaseline,
  getUpstreamBriefSuggestions,
  findLatestReport,
  loadConfig,
} from './upstream-brief-suggestion.ts';

function makeTmp() {
  return mkdtempSync(join(process.cwd(), 'tmp-'));
}

function writeInstalled(repoDir: string, lead: string, version: string) {
  const dir = join(repoDir, 'node_modules', lead);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
}

function writeReport(
  briefDir: string,
  lead: string,
  baseline: string,
  checkedAndClear: { claim: string; holdsFor: string }[],
) {
  mkdirSync(briefDir, { recursive: true });
  writeFileSync(
    join(briefDir, `${lead}-report.json`),
    JSON.stringify({
      schemaVersion: 1,
      date: '2026-09-17',
      commit: 'abc123',
      ecosystems: [{ lead, baseline, checkedAndClear }],
    }),
  );
}

// ── Config Loading ─────────────────────────────────────────────────────

test('loadConfig: loads yaml config', () => {
  const tmpDir = makeTmp();
  try {
    writeFileSync(
      join(tmpDir, 'upstream-brief.config.yml'),
      `
ecosystems:
  - lead: nx
  - lead: next
brief_dir: docs/research
`,
    );

    const config = loadConfig(tmpDir);
    assert(config !== null);
    assert.deepEqual(config.ecosystems, [{ lead: 'nx' }, { lead: 'next' }]);
    assert.equal(config.brief_dir, 'docs/research');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('loadConfig: loads json config', () => {
  const tmpDir = makeTmp();
  try {
    writeFileSync(
      join(tmpDir, 'upstream-brief.config.json'),
      JSON.stringify({
        ecosystems: [{ lead: 'nx' }],
        brief_dir: 'docs/research',
      }),
    );

    const config = loadConfig(tmpDir);
    assert(config !== null);
    assert.deepEqual(config.ecosystems, [{ lead: 'nx' }]);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('loadConfig: returns null when no config found', () => {
  const tmpDir = makeTmp();
  try {
    const config = loadConfig(tmpDir);
    assert.equal(config, null);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

// ── Finding Latest Report ──────────────────────────────────────────────

test('findLatestReport: finds report by ecosystem lead', () => {
  const tmpDir = makeTmp();
  try {
    writeFileSync(
      join(tmpDir, 'upstream-brief-nx.json'),
      JSON.stringify({
        schemaVersion: 1,
        date: '2026-09-17',
        commit: 'abc123',
        ecosystems: [
          {
            lead: 'nx',
            baseline: '22.7.7',
            checkedAndClear: [],
          },
        ],
      }),
    );

    const report = findLatestReport('nx', tmpDir);
    assert(report !== null);
    assert.equal(report.ecosystems[0]?.lead, 'nx');
    assert.equal(report.ecosystems[0]?.baseline, '22.7.7');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('findLatestReport: returns null when no report found', () => {
  const tmpDir = makeTmp();
  try {
    const report = findLatestReport('nonexistent', tmpDir);
    assert.equal(report, null);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('findLatestReport: returns null for directory that does not exist', () => {
  const nonexistent = join(process.cwd(), 'nonexistent-dir-' + Date.now());
  const report = findLatestReport('nx', nonexistent);
  assert.equal(report, null);
});

// ── Ecosystem Baseline Checking ────────────────────────────────────────

test('checkEcosystemBaseline: no suggestion when ecosystem not installed', () => {
  const tmpDir = makeTmp();
  try {
    const result = checkEcosystemBaseline('nonexistent-pkg', tmpDir, tmpDir);
    assert.equal(result, null);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('checkEcosystemBaseline: no suggestion when no report exists', () => {
  const tmpDir = makeTmp();
  try {
    const result = checkEcosystemBaseline('test-pkg', tmpDir, tmpDir);
    assert.equal(result, null);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('checkEcosystemBaseline: no suggestion when baseline unchanged', () => {
  const tmpDir = makeTmp();
  const briefDir = join(tmpDir, 'brief');

  try {
    writeReport(briefDir, 'test-pkg', '1.0.0', []);
    const result = checkEcosystemBaseline('test-pkg', briefDir, tmpDir);
    assert.equal(result, null);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('checkEcosystemBaseline: suggests brief when baseline changed and no ranges', () => {
  const tmpDir = makeTmp();
  const briefDir = join(tmpDir, 'brief');

  try {
    writeInstalled(tmpDir, 'test-pkg', '2.0.0');
    writeReport(briefDir, 'test-pkg', '1.0.0', []);
    const result = checkEcosystemBaseline('test-pkg', briefDir, tmpDir);
    assert.equal(result, 'test-pkg');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('checkEcosystemBaseline: no suggestion when baseline in checkedAndClear range', () => {
  const tmpDir = makeTmp();
  const briefDir = join(tmpDir, 'brief');

  try {
    writeInstalled(tmpDir, 'test-pkg', '1.5.0');
    writeReport(briefDir, 'test-pkg', '1.0.0', [
      { claim: 'Test claim', holdsFor: '>=1.0.0 <2.0.0' },
    ]);
    const result = checkEcosystemBaseline('test-pkg', briefDir, tmpDir);
    assert.equal(result, null);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('checkEcosystemBaseline: suggests when any recorded range no longer covers', () => {
  const tmpDir = makeTmp();
  const briefDir = join(tmpDir, 'brief');

  try {
    writeInstalled(tmpDir, 'test-pkg', '2.0.0');
    writeReport(briefDir, 'test-pkg', '1.0.0', [
      { claim: 'still holds', holdsFor: '>=1.0.0 <3.0.0' },
      { claim: 'exact previous baseline', holdsFor: '1.0.0' },
    ]);
    const result = checkEcosystemBaseline('test-pkg', briefDir, tmpDir);
    assert.equal(result, 'test-pkg');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('checkEcosystemBaseline: no suggestion when the only range is unreadable', () => {
  const tmpDir = makeTmp();
  const briefDir = join(tmpDir, 'brief');

  try {
    writeInstalled(tmpDir, 'test-pkg', '2.0.0');
    writeReport(briefDir, 'test-pkg', '1.0.0', [
      { claim: 'caret range', holdsFor: '^1.0.0' },
    ]);
    const result = checkEcosystemBaseline('test-pkg', briefDir, tmpDir);
    assert.equal(result, null);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

// ── Getting Upstream Brief Suggestions ─────────────────────────────────

test('getUpstreamBriefSuggestions: returns empty array when no config', () => {
  const tmpDir = makeTmp();
  try {
    const suggestions = getUpstreamBriefSuggestions(tmpDir);
    assert.deepEqual(suggestions, []);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('getUpstreamBriefSuggestions: returns empty array when no ecosystems configured', () => {
  const tmpDir = makeTmp();
  try {
    writeFileSync(
      join(tmpDir, 'upstream-brief.config.json'),
      JSON.stringify({ ecosystems: [] }),
    );

    const suggestions = getUpstreamBriefSuggestions(tmpDir);
    assert.deepEqual(suggestions, []);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('getUpstreamBriefSuggestions: gracefully handles missing ecosystem in config', () => {
  const tmpDir = makeTmp();
  try {
    writeFileSync(
      join(tmpDir, 'upstream-brief.config.json'),
      JSON.stringify({ ecosystems: [{ noLead: 'invalid' }] }),
    );

    const suggestions = getUpstreamBriefSuggestions(tmpDir);
    assert.deepEqual(suggestions, []);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});
